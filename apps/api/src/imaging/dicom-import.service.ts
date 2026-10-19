import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { imagingSeries, imagingStudies } from "@health-mcp/db";
import type { DicomImportResult } from "@health-mcp/shared";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import yauzl from "yauzl";

import { isUniqueViolation } from "../common/sqlite-errors.js";
import { DatabaseService } from "../database/database.service.js";
import { PatientsService } from "../patients/patients.service.js";
import { type DicomImageInfo, readDicomFile } from "./dicom.js";
import { ImagingStorage } from "./imaging-storage.js";

/** Largest single file read from a zip; DICOM images are far smaller. */
const MAX_ENTRY_BYTES = 512 * 1024 ** 2;
/** Limits that stop a hostile zip ("zip bomb") from filling the disk or memory. */
const MAX_TOTAL_BYTES = 8 * 1024 ** 3;
const MAX_ENTRIES = 100_000;

interface StagedImage {
  file: string;
  instanceNumber: number;
  frame: number;
  sequence: number;
}

interface StagedSeries {
  info: DicomImageInfo;
  images: StagedImage[];
  /** Frames in a pixel format the viewer cannot show. */
  unsupported: number;
}

interface StagedStudy {
  info: DicomImageInfo;
  series: Map<string, StagedSeries>;
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) =>
      error ? reject(error) : resolve(zip),
    ),
  );
}

function nextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | undefined> {
  return new Promise((resolve, reject) => {
    const done = () => {
      zip.off("entry", onEntry).off("end", onEnd).off("error", onError);
    };
    const onEntry = (entry: yauzl.Entry) => (done(), resolve(entry));
    const onEnd = () => (done(), resolve(undefined));
    const onError = (error: Error) => (done(), reject(error));
    zip.on("entry", onEntry).on("end", onEnd).on("error", onError);
    zip.readEntry();
  });
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    }),
  );
}

/** The value most series share, e.g. the study's modality. */
function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Imports a zip of DICOM files (e.g. a CD/DVD export) for one patient. Each
 * image is turned into PNG slices; studies and series are recognized by their
 * UIDs, which are only kept as hashes. Nothing identifying from the files is
 * stored: the study belongs to the patient it was uploaded for.
 */
@Injectable()
export class DicomImportService {
  private readonly logger = new Logger(DicomImportService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly patients: PatientsService,
    private readonly storage: ImagingStorage,
  ) {}

  async importZip(patientId: string, zipFile: string): Promise<DicomImportResult> {
    this.patients.get(patientId);
    const staging = path.join(this.storage.root, `.staging-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      const { studies, skippedFiles, unsupportedImages } = await this.stage(zipFile, staging);
      const results: DicomImportResult["studies"] = [];
      for (const study of studies.values()) results.push(await this.save(patientId, study));
      this.logger.log(
        `DICOM upload for patient ${patientId}: ${results.length} studies, ` +
          `${skippedFiles} other files, ${unsupportedImages} unsupported images`,
      );
      return { studies: results, skippedFiles, unsupportedImages };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Reads every file of the zip, writing the slices of each image to `staging`. */
  private async stage(zipFile: string, staging: string) {
    let zip: yauzl.ZipFile;
    try {
      zip = await openZip(zipFile);
    } catch {
      throw new BadRequestException("The upload is not a valid zip file");
    }

    const studies = new Map<string, StagedStudy>();
    let skippedFiles = 0;
    let unsupportedImages = 0;
    let totalBytes = 0;
    let entries = 0;
    let sequence = 0;

    for (let entry = await nextEntry(zip); entry; entry = await nextEntry(zip)) {
      if (entry.fileName.endsWith("/")) continue;
      if (++entries > MAX_ENTRIES) throw new BadRequestException("The zip has too many files");
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_TOTAL_BYTES) throw new BadRequestException("The zip is too large");
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        skippedFiles++;
        continue;
      }

      const result = readDicomFile(await readEntry(zip, entry));
      if (result.kind === "not-dicom" || result.kind === "no-image") {
        skippedFiles++;
        continue;
      }

      const { info } = result;
      const study = studies.get(info.studyHash) ?? { info, series: new Map() };
      studies.set(info.studyHash, study);
      const series = study.series.get(info.seriesHash) ?? { info, images: [], unsupported: 0 };
      study.series.set(info.seriesHash, series);

      if (result.kind === "unsupported") {
        series.unsupported += result.frames;
        unsupportedImages += result.frames;
        continue;
      }
      for (const [frame, png] of result.frames.entries()) {
        const file = path.join(staging, `${sequence}.png`);
        await writeFile(file, png);
        series.images.push({
          file,
          instanceNumber: info.instanceNumber ?? Number.MAX_SAFE_INTEGER,
          frame,
          sequence: sequence++,
        });
      }
    }
    return { studies, skippedFiles, unsupportedImages };
  }

  /** Saves one study unless this patient already has it; moves its slices into place. */
  private async save(
    patientId: string,
    study: StagedStudy,
  ): Promise<DicomImportResult["studies"][number]> {
    const { db } = this.database;
    const allSeries = [...study.series.values()];
    const infos = allSeries.map((s) => s.info);
    const details = {
      modality: mostCommon(infos.map((info) => info.modality)) ?? "OT",
      studyDate:
        infos.find((info) => info.studyDate)?.studyDate ?? new Date().toISOString().slice(0, 10),
      description: infos.find((info) => info.studyDescription)?.studyDescription,
      bodyPart: infos.find((info) => info.bodyPart)?.bodyPart,
    };
    const summary = (studyId: string, alreadyImported: boolean) => ({
      studyId,
      modality: details.modality,
      ...(details.description !== undefined && { description: details.description }),
      studyDate: details.studyDate,
      series: allSeries.length,
      images: allSeries.reduce((sum, s) => sum + s.images.length, 0),
      alreadyImported,
    });

    const existing = () =>
      db
        .select({ id: imagingStudies.id })
        .from(imagingStudies)
        .where(
          and(
            eq(imagingStudies.patientId, patientId),
            eq(imagingStudies.dicomStudyHash, study.info.studyHash),
          ),
        )
        .get();
    const before = existing();
    if (before) return summary(before.id, true);

    const studyId = randomUUID();
    const seriesRows = [...allSeries]
      .sort((a, b) => (a.info.seriesNumber ?? Infinity) - (b.info.seriesNumber ?? Infinity))
      .map((series) => ({ id: randomUUID(), series }));

    try {
      for (const { id, series } of seriesRows) {
        const dir = this.storage.seriesDir(studyId, id);
        await mkdir(dir, { recursive: true });
        const ordered = series.images.sort(
          (a, b) =>
            a.instanceNumber - b.instanceNumber || a.frame - b.frame || a.sequence - b.sequence,
        );
        for (const [position, image] of ordered.entries())
          await rename(image.file, this.storage.imagePath(studyId, id, position));
      }
      db.transaction((tx) => {
        tx.insert(imagingStudies)
          .values({
            id: studyId,
            patientId,
            ...details,
            source: "dicom",
            dicomStudyHash: study.info.studyHash,
          })
          .run();
        tx.insert(imagingSeries)
          .values(
            seriesRows.map(({ id, series }) => ({
              id,
              studyId,
              seriesNumber: series.info.seriesNumber,
              description: series.info.seriesDescription,
              modality: series.info.modality,
              imageCount: series.images.length,
            })),
          )
          .run();
      });
      return summary(studyId, false);
    } catch (error) {
      await this.storage.removeStudies([studyId]);
      // The same study was saved by a concurrent upload.
      const concurrent = isUniqueViolation(error) ? existing() : undefined;
      if (concurrent) return summary(concurrent.id, true);
      throw error;
    }
  }
}
