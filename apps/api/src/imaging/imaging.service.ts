import { imagingSeries, imagingStudies, toImagingStudy } from "@health-mcp/db";
import type { ImagingStudy, UpdateImagingStudyInput } from "@health-mcp/shared";
import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { DatabaseService } from "../database/database.service.js";
import { PatientsService } from "../patients/patients.service.js";
import { ImagingStorage } from "./imaging-storage.js";

/** Reads and edits a patient's imaging studies. Uploads are in `DicomImportService`. */
@Injectable()
export class ImagingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly patients: PatientsService,
    private readonly storage: ImagingStorage,
  ) {}

  /** Newest first, with their series. Throws 404 if the patient does not exist. */
  list(patientId: string): ImagingStudy[] {
    this.patients.get(patientId);
    const { db } = this.database;
    const studies = db
      .select()
      .from(imagingStudies)
      .where(eq(imagingStudies.patientId, patientId))
      .orderBy(desc(imagingStudies.studyDate), desc(imagingStudies.createdAt))
      .all();
    const series = db
      .select()
      .from(imagingSeries)
      .where(
        inArray(
          imagingSeries.studyId,
          studies.map((study) => study.id),
        ),
      )
      .orderBy(asc(imagingSeries.seriesNumber), asc(imagingSeries.description))
      .all();
    return studies.map((study) =>
      toImagingStudy(
        study,
        series.filter((s) => s.studyId === study.id),
      ),
    );
  }

  /** Throws 404 if the patient or the study (of this patient) does not exist. */
  get(patientId: string, studyId: string): ImagingStudy {
    const study = this.list(patientId).find((s) => s.id === studyId);
    if (!study) throw new NotFoundException(`Imaging study ${studyId} not found`);
    return study;
  }

  update(patientId: string, studyId: string, input: UpdateImagingStudyInput): ImagingStudy {
    this.get(patientId, studyId);
    if (Object.keys(input).length > 0)
      this.database.db
        .update(imagingStudies)
        .set(input)
        .where(and(eq(imagingStudies.id, studyId), eq(imagingStudies.patientId, patientId)))
        .run();
    return this.get(patientId, studyId);
  }

  /** Deletes the study, its series and its images. */
  async remove(patientId: string, studyId: string): Promise<void> {
    this.get(patientId, studyId);
    this.database.db.delete(imagingStudies).where(eq(imagingStudies.id, studyId)).run();
    await this.storage.removeStudies([studyId]);
  }

  /** The PNG file of one slice. Throws 404 unless it belongs to this patient's study. */
  imageFile(patientId: string, studyId: string, seriesId: string, position: number): string {
    const series = this.get(patientId, studyId).series.find((s) => s.id === seriesId);
    if (!series || !Number.isInteger(position) || position < 0 || position >= series.imageCount)
      throw new NotFoundException("Image not found");
    return this.storage.imagePath(studyId, seriesId, position);
  }
}
