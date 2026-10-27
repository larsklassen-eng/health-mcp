import {
  chatMessages,
  createDb,
  type DbConnection,
  imagingStudies,
  migrateDb,
  patients,
  symptoms,
} from "@health-mcp/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type Embedder,
  HashingEmbedder,
  patientSources,
  syncAllPatients,
  syncPatientIndex,
} from "../src/index.js";

/** The hashing stand-in, counting how many texts it embeds. */
class CountingEmbedder extends HashingEmbedder implements Embedder {
  embedded = 0;
  override async embedDocuments(texts: readonly string[]) {
    this.embedded += texts.length;
    return super.embedDocuments(texts);
  }
}

let connection: DbConnection;
let embedder: CountingEmbedder;
const db = () => connection.db;

beforeEach(() => {
  connection = createDb({ path: ":memory:" });
  migrateDb(connection.db);
  embedder = new CountingEmbedder();
});
afterEach(() => connection.close());

const addPatient = (mrn = "FAKE-1", notes?: string) =>
  db()
    .insert(patients)
    .values({
      mrn,
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      diagnosis: "Synthetic meningioma",
      ...(notes && { notes }),
    })
    .returning()
    .get().id;

const chunkSources = () =>
  (
    db()
      .$client.prepare("select source_type || ':' || source_id as s from record_chunks order by s")
      .all() as { s: string }[]
  ).map((row) => row.s);

describe("patientSources", () => {
  it("collects notes, reports, symptoms and the clinician's chat messages", () => {
    const patient = addPatient("FAKE-1", "Walking unaided.");
    db()
      .insert(imagingStudies)
      .values([
        {
          patientId: patient,
          modality: "MR",
          studyDate: "2026-08-18",
          source: "import",
          report: "Stable.",
        },
        { patientId: patient, modality: "CT", studyDate: "2026-08-06", source: "dicom" },
      ])
      .run();
    db()
      .insert(symptoms)
      .values({
        patientId: patient,
        name: "Headache",
        severity: 3,
        recordedAt: "2026-10-01T08:00:00Z",
      })
      .run();
    db()
      .insert(chatMessages)
      .values([
        { patientId: patient, role: "user", content: "She felt dizzy." },
        { patientId: patient, role: "assistant", content: "Noted." },
      ])
      .run();

    const types = patientSources(db(), patient).map((s) => s.sourceType);

    // The study without a report and the assistant's answer have nothing to index.
    expect(types).toEqual(["patient_notes", "imaging_report", "symptom", "chat_message"]);
    expect(patientSources(db(), "does-not-exist")).toEqual([]);
  });
});

describe("syncPatientIndex", () => {
  it("indexes new records, then skips them while nothing changes", async () => {
    const patient = addPatient("FAKE-1", "Walking unaided.");
    db()
      .insert(symptoms)
      .values({
        patientId: patient,
        name: "Headache",
        severity: 3,
        recordedAt: "2026-10-01T08:00:00Z",
      })
      .run();

    expect(await syncPatientIndex(db(), embedder, patient)).toEqual({
      indexed: 2,
      removed: 0,
      unchanged: 0,
    });
    const embedded = embedder.embedded;

    expect(await syncPatientIndex(db(), embedder, patient)).toEqual({
      indexed: 0,
      removed: 0,
      unchanged: 2,
    });
    expect(embedder.embedded).toBe(embedded);
  });

  it("re-embeds only the record that changed", async () => {
    const patient = addPatient("FAKE-1", "Walking unaided.");
    db()
      .insert(symptoms)
      .values({
        patientId: patient,
        name: "Headache",
        severity: 3,
        recordedAt: "2026-10-01T08:00:00Z",
      })
      .run();
    await syncPatientIndex(db(), embedder, patient);
    embedder.embedded = 0;

    db()
      .update(symptoms)
      .set({ notes: "Worse in the morning." })
      .where(eq(symptoms.patientId, patient))
      .run();

    expect(await syncPatientIndex(db(), embedder, patient)).toEqual({
      indexed: 1,
      removed: 0,
      unchanged: 1,
    });
    expect(embedder.embedded).toBe(1);
  });

  it("removes the chunks of deleted records and emptied text", async () => {
    const patient = addPatient("FAKE-1", "Walking unaided.");
    const study = db()
      .insert(imagingStudies)
      .values({
        patientId: patient,
        modality: "MR",
        studyDate: "2026-08-18",
        source: "import",
        report: "Stable.",
      })
      .returning()
      .get();
    await syncPatientIndex(db(), embedder, patient);

    db().delete(imagingStudies).where(eq(imagingStudies.id, study.id)).run();
    db().update(patients).set({ notes: null }).where(eq(patients.id, patient)).run();

    expect(await syncPatientIndex(db(), embedder, patient)).toEqual({
      indexed: 0,
      removed: 2,
      unchanged: 0,
    });
    expect(chunkSources()).toEqual([]);
  });

  it("leaves other patients' chunks alone", async () => {
    const ana = addPatient("FAKE-1", "Ana's notes.");
    const ben = addPatient("FAKE-2", "Ben's notes.");
    await syncPatientIndex(db(), embedder, ben);

    await syncPatientIndex(db(), embedder, ana);
    db().delete(patients).where(eq(patients.id, ana)).run();

    expect(chunkSources()).toEqual([`patient_notes:${ben}`]);
  });
});

describe("syncAllPatients", () => {
  it("syncs every patient, and with full re-embeds everything", async () => {
    addPatient("FAKE-1", "Ana's notes.");
    addPatient("FAKE-2", "Ben's notes.");

    expect(await syncAllPatients(db(), embedder)).toEqual({
      patients: 2,
      indexed: 2,
      removed: 0,
      unchanged: 0,
    });
    expect(await syncAllPatients(db(), embedder)).toMatchObject({ indexed: 0, unchanged: 2 });
    expect(await syncAllPatients(db(), embedder, { full: true })).toMatchObject({
      indexed: 2,
      unchanged: 0,
    });
  });
});
