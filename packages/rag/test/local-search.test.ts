import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { createDb, migrateDb, patients, toPatient } from "@health-mcp/db";
import { PatientImportFileSchema } from "@health-mcp/shared";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_EMBEDDING_MODEL,
  imagingStudySource,
  indexSource,
  LocalEmbedder,
  patientNotesSource,
  resolveModelDir,
  searchPatientChunks,
  symptomSource,
} from "../src/index.js";

/*
 * Search quality with the real model on one synthetic patient. Runs only where
 * the model is downloaded (`yarn rag:model`), so CI never downloads it.
 */
const downloaded = existsSync(path.join(resolveModelDir(), DEFAULT_EMBEDDING_MODEL));

describe.runIf(downloaded)("search with the real model", () => {
  const { db } = createDb({ path: ":memory:" });
  const embedder = new LocalEmbedder({ allowDownload: false });
  let patientId: string;
  const search = (query: string) => searchPatientChunks(db, embedder, patientId, query);

  beforeAll(async () => {
    migrateDb(db);
    const bundle = PatientImportFileSchema.parse(
      JSON.parse(
        readFileSync(new URL("../../../fixtures/synthetic-patients.json", import.meta.url), "utf8"),
      ),
    ).patients.find((b) => b.patient.mrn === "FAKE-GBM-0001")!;
    const patient = toPatient(db.insert(patients).values(bundle.patient).returning().get());
    patientId = patient.id;
    const ref = (sourceType: "patient_notes" | "imaging_report" | "symptom", sourceId: string) => ({
      patientId,
      sourceType,
      sourceId,
    });
    await indexSource(db, embedder, ref("patient_notes", patientId), patientNotesSource(patient));
    for (const [i, study] of bundle.imagingStudies.entries())
      await indexSource(
        db,
        embedder,
        ref("imaging_report", `s${i}`),
        imagingStudySource({ id: `s${i}`, ...study }),
      );
    for (const [i, s] of bundle.symptoms.entries())
      await indexSource(
        db,
        embedder,
        ref("symptom", `y${i}`),
        symptomSource({ id: `y${i}`, ...s }),
      );
  }, 60_000);

  it("finds the postoperative MRI report among the first results", async () => {
    const titles = (await search("What did the post-operative MRI show?")).map(
      (r) => r.text.split("\n")[0],
    );

    expect(titles.slice(0, 2)).toContain(
      "Imaging report: MRI brain with and without contrast (postoperative) (2026-08-18)",
    );
  });

  it("matches meaning, not only words", async () => {
    const [first] = await search("Has he felt nauseous?");

    expect(first?.text).toMatch(/Nausea, severity/);
  });

  it("returns nothing for an unrelated question", async () => {
    expect(await search("What is the weather like today?")).toEqual([]);
  });
});
