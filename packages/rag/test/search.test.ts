import { createDb, type DbConnection, migrateDb, patients } from "@health-mcp/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HashingEmbedder,
  type Reranker,
  indexSource,
  keywordQuery,
  searchPatientChunks,
  type SourceRef,
  type TextSource,
} from "../src/index.js";

let connection: DbConnection;
const embedder = new HashingEmbedder();

beforeEach(() => {
  connection = createDb({ path: ":memory:" });
  migrateDb(connection.db);
});
afterEach(() => connection.close());

const addPatient = (mrn: string) =>
  connection.db
    .insert(patients)
    .values({
      mrn,
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      diagnosis: "Synthetic meningioma",
    })
    .returning()
    .get().id;

const symptom = (patientId: string, id: string, text: string, date = "2026-10-01") => {
  const ref: SourceRef = { patientId, sourceType: "symptom", sourceId: id };
  const source: TextSource = {
    sourceType: "symptom",
    sourceId: id,
    sourceDate: date,
    title: `Symptom (${date})`,
    text,
  };
  return { ref, source };
};

async function index(patientId: string, id: string, text: string) {
  const { ref, source } = symptom(patientId, id, text);
  return indexSource(connection.db, embedder, ref, source);
}

const count = (table: string) =>
  (connection.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

describe("indexSource", () => {
  it("stores a source's chunks with their vectors, and replaces them when it changes", async () => {
    const patient = addPatient("FAKE-1");

    expect(await index(patient, "y1", "Headache in the morning.")).toBe(1);
    await index(patient, "y1", "Nausea after lunch.");

    expect(count("record_chunks")).toBe(1);
    expect(count("vec_chunks")).toBe(1);
    const [result] = await searchPatientChunks(connection.db, embedder, patient, "nausea");
    expect(result?.text).toBe("Symptom (2026-10-01)\nNausea after lunch.");
  });

  it("removes a source's chunks when it has no text, leaving others alone", async () => {
    const patient = addPatient("FAKE-1");
    await index(patient, "y1", "Headache.");
    await index(patient, "y2", "Nausea.");

    const { ref } = symptom(patient, "y1", "");
    expect(await indexSource(connection.db, embedder, ref, undefined)).toBe(0);

    expect(count("record_chunks")).toBe(1);
    expect(count("vec_chunks")).toBe(1);
  });
});

describe("searchPatientChunks", () => {
  it("only searches the given patient's chunks", async () => {
    const ana = addPatient("FAKE-1");
    const ben = addPatient("FAKE-2");
    await index(ana, "y1", "Headache in the morning.");
    await index(ben, "y2", "Headache in the morning too.");

    // The word-hashing stand-in gives short texts low similarities.
    const results = await searchPatientChunks(connection.db, embedder, ana, "headache", {
      minSimilarity: 0.1,
    });

    expect(results.map((r) => r.sourceId)).toEqual(["y1"]);
    expect(results[0]).toMatchObject({
      sourceType: "symptom",
      sourceDate: "2026-10-01",
      matchedBy: ["vector", "keyword"],
    });
  });

  it("ranks a passage found by both searches above one found by either", async () => {
    const patient = addPatient("FAKE-1");
    await index(patient, "y1", "Morning walk around the block.");
    await index(patient, "y2", "Headache every morning after waking.");
    await index(patient, "y3", "Platelets were low.");

    const results = await searchPatientChunks(
      connection.db,
      embedder,
      patient,
      "headache morning",
      {
        minSimilarity: 0.1,
      },
    );

    expect(results.map((r) => r.sourceId)).toEqual(["y2", "y1"]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("drops weak vector-only matches, but keeps keyword matches", async () => {
    const patient = addPatient("FAKE-1");
    await index(patient, "y1", "Temozolomide started.");
    await index(patient, "y2", "Started walking again with friends nearby today.");

    const results = await searchPatientChunks(connection.db, embedder, patient, "temozolomide", {
      minSimilarity: 0.99,
    });

    expect(results.map((r) => [r.sourceId, r.matchedBy])).toEqual([["y1", ["keyword"]]]);
  });

  it("returns nothing when nothing is related", async () => {
    const patient = addPatient("FAKE-1");
    await index(patient, "y1", "Headache.");

    expect(await searchPatientChunks(connection.db, embedder, patient, "kidney function")).toEqual(
      [],
    );
  });

  it("limits the number of results and the kinds of sources", async () => {
    const patient = addPatient("FAKE-1");
    for (let n = 1; n <= 8; n++) await index(patient, `y${n}`, `Headache number ${n}.`);
    await indexSource(
      connection.db,
      embedder,
      { patientId: patient, sourceType: "patient_notes", sourceId: patient },
      {
        sourceType: "patient_notes",
        sourceId: patient,
        sourceDate: "2026-10-01",
        title: "Clinician notes",
        text: "Headache since surgery.",
      },
    );

    const top = await searchPatientChunks(connection.db, embedder, patient, "headache", { k: 3 });
    const notes = await searchPatientChunks(connection.db, embedder, patient, "headache", {
      sources: ["patient_notes"],
    });

    expect(top).toHaveLength(3);
    expect(notes.map((r) => r.sourceType)).toEqual(["patient_notes"]);
  });

  it("copes with queries made of punctuation or FTS5 syntax", async () => {
    const patient = addPatient("FAKE-1");
    await index(patient, "y1", "Headache.");

    for (const query of ['"', "head*", "NEAR(a b)", "-", "the and of"])
      await expect(
        searchPatientChunks(connection.db, embedder, patient, query),
      ).resolves.toBeInstanceOf(Array);
  });
});

describe("keywordQuery", () => {
  it("quotes the meaningful words and drops common ones", () => {
    expect(keywordQuery("Has she had any HEADACHES, or nausea?")).toBe('"headaches" OR "nausea"');
    expect(keywordQuery("Did he? Is it?")).toBeUndefined();
    expect(keywordQuery('head" OR 1')).toBe('"head" OR "1"');
  });
});

describe("searchPatientChunks with a reranker", () => {
  /** Ranks passages that mention `favourite` first, and records what it was asked. */
  const fakeReranker = (favourite: string) => {
    const calls: { query: string; texts: readonly string[] }[] = [];
    const reranker: Reranker = {
      model: "fake",
      async rerank(query, texts) {
        calls.push({ query, texts });
        return texts.map((text) => (text.includes(favourite) ? 10 : 0));
      },
    };
    return { reranker, calls };
  };

  it("re-orders the filtered candidates by the reranker's score", async () => {
    const patient = addPatient("FAKE-1");
    await index(patient, "y1", "Headache in the morning, worse with coughing.");
    await index(patient, "y2", "Headache with nausea.");
    await index(patient, "y3", "Headache when standing up, with dizziness.");
    const { reranker, calls } = fakeReranker("dizziness");

    const results = await searchPatientChunks(connection.db, embedder, patient, "headache", {
      k: 2,
      reranker,
      minSimilarity: 0.1,
    });

    expect(results.map((r) => r.sourceId)).toEqual(["y3", expect.any(String)]);
    expect(results[0]!.rerankScore).toBe(10);
    expect(results[1]!.rerankScore).toBe(0);
    // It saw every candidate, with the question, including the title line.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toBe("headache");
    expect(calls[0]!.texts).toHaveLength(3);
    expect(calls[0]!.texts[0]).toMatch(/^Symptom \(2026-10-01\)\n/);
  });

  it("re-scores at most the best 20 candidates", async () => {
    const patient = addPatient("FAKE-1");
    for (let i = 0; i < 25; i++) await index(patient, `y${i}`, `Headache number ${i}.`);
    const { reranker, calls } = fakeReranker("number 24");

    const results = await searchPatientChunks(connection.db, embedder, patient, "headache", {
      reranker,
      minSimilarity: 0.1,
    });

    expect(calls[0]!.texts).toHaveLength(20);
    expect(results).toHaveLength(5);
  });

  it("does not call the reranker when nothing is relevant", async () => {
    const patient = addPatient("FAKE-1");
    await index(patient, "y1", "Headache in the morning.");
    const { reranker, calls } = fakeReranker("anything");

    expect(
      await searchPatientChunks(connection.db, embedder, patient, "weather forecast", { reranker }),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });
});
