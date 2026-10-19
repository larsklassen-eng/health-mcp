import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { imagingStudies } from "@health-mcp/db";
import {
  API_ROUTES,
  DicomImportResultSchema,
  ImagingStudyListResponseSchema,
  ImagingStudySchema,
  type Patient,
  PatientSchema,
} from "@health-mcp/shared";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { AppModule } from "../src/app.module.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/database/database.service.js";
import {
  syntheticDicomFile,
  type SyntheticImage,
  syntheticUid,
} from "../src/imaging/synthetic-dicom.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
let imagingDir: string;
let patient: Patient;

beforeEach(async () => {
  imagingDir = await mkdtemp(path.join(tmpdir(), "health-mcp-imaging-"));
  testApp = await startTestApp(AppModule, [
    { provide: ENV, useValue: { ...loadEnv(), IMAGING_DIR: imagingDir } },
  ]);
  patient = await createPatient("FAKE-IMG-1");
});
afterEach(async () => {
  await testApp.close();
  await rm(imagingDir, { recursive: true, force: true });
});

async function createPatient(mrn: string): Promise<Patient> {
  const { body } = await testApp.request("POST", API_ROUTES.patients, newPatient({ mrn }));
  return PatientSchema.parse(body);
}

function zip(files: Record<string, Uint8Array | string>): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const [name, data] of Object.entries(files)) archive.addBuffer(Buffer.from(data), name);
  archive.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on("error", reject);
  });
}

async function upload(body: Buffer, patientId = patient.id, type = "application/zip") {
  const response = await fetch(`${testApp.url}${API_ROUTES.dicomUpload(patientId)}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body: new Uint8Array(body),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function studies(patientId = patient.id) {
  const { body } = await testApp.request("GET", API_ROUTES.patientImaging(patientId));
  return ImagingStudyListResponseSchema.parse(body).studies;
}

/** A slice whose pixels all have one value, so its PNG shows which slice it is. */
const flatSlice = (value: number, overrides: Partial<SyntheticImage>): SyntheticImage => ({
  studyUid: "",
  seriesUid: "",
  rows: 8,
  columns: 8,
  pixels: new Uint16Array(64).fill(value),
  windowCenter: 2048,
  windowWidth: 4096,
  ...overrides,
});

/** A study with an 3-slice MR series (files out of order), a 1-slice series and a text file. */
async function studyZip(studyUid = syntheticUid()) {
  const t1 = syntheticUid();
  const t2 = syntheticUid();
  const common = {
    studyUid,
    studyDate: "2026-10-01",
    studyDescription: "MRI brain with contrast",
    bodyPart: "BRAIN",
  };
  return zip({
    "DICOM/S2/IM3": syntheticDicomFile(
      flatSlice(3000, {
        ...common,
        seriesUid: t1,
        seriesNumber: 2,
        instanceNumber: 3,
        seriesDescription: "Ax T1 post",
      }),
    ),
    "DICOM/S2/IM1": syntheticDicomFile(
      flatSlice(1000, {
        ...common,
        seriesUid: t1,
        seriesNumber: 2,
        instanceNumber: 1,
        seriesDescription: "Ax T1 post",
      }),
    ),
    "DICOM/S2/IM2": syntheticDicomFile(
      flatSlice(2000, {
        ...common,
        seriesUid: t1,
        seriesNumber: 2,
        instanceNumber: 2,
        seriesDescription: "Ax T1 post",
      }),
    ),
    "DICOM/S1/IM1": syntheticDicomFile(
      flatSlice(500, { ...common, seriesUid: t2, seriesNumber: 1, seriesDescription: "Localizer" }),
    ),
    "README.TXT": "Viewer software would be here.",
  });
}

async function imageGray(studyId: string, seriesId: string, position: number) {
  const response = await fetch(
    `${testApp.url}${API_ROUTES.imagingImage(patient.id, studyId, seriesId, position)}`,
  );
  if (response.status !== 200) return response.status;
  expect(response.headers.get("content-type")).toBe("image/png");
  return PNG.sync.read(Buffer.from(await response.arrayBuffer())).data[0];
}

describe("POST /patients/:id/imaging/dicom", () => {
  it("imports a study with its series and reports what was skipped", async () => {
    const { status, body } = await upload(await studyZip());

    expect(status).toBe(201);
    const result = DicomImportResultSchema.parse(body);
    expect(result).toMatchObject({
      skippedFiles: 1,
      unsupportedImages: 0,
      studies: [
        {
          modality: "MR",
          description: "MRI brain with contrast",
          studyDate: "2026-10-01",
          series: 2,
          images: 4,
          alreadyImported: false,
        },
      ],
    });

    const [study] = await studies();
    expect(study).toMatchObject({
      id: result.studies[0]!.studyId,
      modality: "MR",
      bodyPart: "Brain",
      studyDate: "2026-10-01",
      source: "dicom",
    });
    expect(study!.series.map((s) => [s.seriesNumber, s.description, s.imageCount])).toEqual([
      [1, "Localizer", 1],
      [2, "Ax T1 post", 3],
    ]);
  });

  it("serves the slices in instance order as PNG", async () => {
    await upload(await studyZip());
    const [study] = await studies();
    const t1 = study!.series[1]!;

    const grays = [
      await imageGray(study!.id, t1.id, 0),
      await imageGray(study!.id, t1.id, 1),
      await imageGray(study!.id, t1.id, 2),
    ];

    expect(grays[0]).toBeLessThan(grays[1] as number);
    expect(grays[1]).toBeLessThan(grays[2] as number);
    expect(await imageGray(study!.id, t1.id, 3)).toBe(404);
  });

  it("stores nothing that identifies the patient in the files", async () => {
    const studyUid = syntheticUid();
    await upload(await studyZip(studyUid));

    const stored = JSON.stringify(
      testApp.app.get(DatabaseService).db.select().from(imagingStudies).all(),
    );
    expect(stored).not.toContain("PHANTOM");
    expect(stored).not.toContain("19000101");
    expect(stored).not.toContain(studyUid);
  });

  it("recognizes a study uploaded again and saves nothing new", async () => {
    const file = await studyZip();
    const first = DicomImportResultSchema.parse((await upload(file)).body);

    const again = DicomImportResultSchema.parse((await upload(file)).body);

    expect(again.studies).toEqual([{ ...first.studies[0], alreadyImported: true }]);
    expect(await studies()).toHaveLength(1);
  });

  it("keeps the same study separate for another patient", async () => {
    const other = await createPatient("FAKE-IMG-2");
    const file = await studyZip();

    await upload(file);
    const result = DicomImportResultSchema.parse((await upload(file, other.id)).body);

    expect(result.studies[0]?.alreadyImported).toBe(false);
    expect(await studies(other.id)).toHaveLength(1);
  });

  it("counts compressed images it cannot show", async () => {
    const common = {
      studyUid: syntheticUid(),
      seriesUid: syntheticUid(),
      seriesDescription: "JPEG",
    };
    const file = await zip({
      a: syntheticDicomFile({ ...common, transferSyntax: "1.2.840.10008.1.2.4.70" }),
      b: syntheticDicomFile({
        ...common,
        instanceNumber: 2,
        transferSyntax: "1.2.840.10008.1.2.4.70",
      }),
    });

    const result = DicomImportResultSchema.parse((await upload(file)).body);

    expect(result.unsupportedImages).toBe(2);
    expect((await studies())[0]?.series).toEqual([
      expect.objectContaining({ description: "JPEG", imageCount: 0 }),
    ]);
  });

  it("rejects non-zip bodies, the wrong content type and unknown patients", async () => {
    expect((await upload(Buffer.from("not a zip"))).status).toBe(400);
    expect((await upload(await studyZip(), patient.id, "text/plain")).status).toBe(415);
    expect((await upload(await studyZip(), "does-not-exist")).status).toBe(404);
    expect(await studies()).toEqual([]);
  });
});

describe("imaging studies", () => {
  it("edits the report and impression, and null clears them", async () => {
    await upload(await studyZip());
    const [study] = await studies();
    const url = API_ROUTES.imagingStudy(patient.id, study!.id);

    const edited = await testApp.request("PATCH", url, {
      impression: "Synthetic: stable.",
      report: "Synthetic report.",
    });
    expect(edited.status).toBe(200);
    expect(ImagingStudySchema.parse(edited.body)).toMatchObject({
      impression: "Synthetic: stable.",
      report: "Synthetic report.",
    });

    const cleared = ImagingStudySchema.parse(
      (await testApp.request("PATCH", url, { impression: null })).body,
    );
    expect(cleared).not.toHaveProperty("impression");
    expect(cleared.report).toBe("Synthetic report.");
  });

  it("deletes a study with its images", async () => {
    await upload(await studyZip());
    const [study] = await studies();

    const { status } = await testApp.request(
      "DELETE",
      API_ROUTES.imagingStudy(patient.id, study!.id),
    );

    expect(status).toBe(204);
    expect(await studies()).toEqual([]);
    expect(existsSync(path.join(imagingDir, study!.id))).toBe(false);
  });

  it("deletes the images when the patient is deleted", async () => {
    await upload(await studyZip());
    const [study] = await studies();
    expect(existsSync(path.join(imagingDir, study!.id))).toBe(true);

    await testApp.request("DELETE", API_ROUTES.patient(patient.id));

    expect(existsSync(path.join(imagingDir, study!.id))).toBe(false);
  });

  it("does not serve another patient's study or images", async () => {
    await upload(await studyZip());
    const [study] = await studies();
    const other = await createPatient("FAKE-IMG-2");

    const get = await testApp.request("GET", API_ROUTES.imagingStudy(other.id, study!.id));
    const image = await fetch(
      `${testApp.url}${API_ROUTES.imagingImage(other.id, study!.id, study!.series[0]!.id, 0)}`,
    );

    expect(get.status).toBe(404);
    expect(image.status).toBe(404);
  });
});
