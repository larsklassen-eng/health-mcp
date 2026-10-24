import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type DbConnection, EMBEDDING_DIMENSIONS, patients, recordChunks } from "../src/index.js";
import { createTestDb, insertPatient, sqliteErrorCode } from "./helpers.js";

let connection: DbConnection;
beforeEach(() => {
  connection = createTestDb();
});
afterEach(() => {
  connection.close();
});

/** A unit vector pointing along `axis`: identical axes are a perfect match. */
const vector = (axis: number) => {
  const values = new Float32Array(EMBEDDING_DIMENSIONS);
  values[axis] = 1;
  return values;
};

function addChunk(patientId: string, text: string, axis: number, sourceId = text) {
  const { id } = connection.db
    .insert(recordChunks)
    .values({
      patientId,
      sourceType: "symptom",
      sourceId,
      sourceDate: "2026-10-01",
      chunkIndex: 0,
      text,
    })
    .returning()
    .get();
  connection.db.$client
    .prepare("insert into vec_chunks (rowid, patient_id, embedding) values (?, ?, ?)")
    .run(BigInt(id), patientId, vector(axis));
  return id;
}

const nearest = (patientId: string, axis: number) =>
  connection.db.$client
    .prepare(
      "select rowid as id, distance from vec_chunks " +
        "where embedding match ? and k = 5 and patient_id = ? order by distance",
    )
    .all(vector(axis), patientId) as { id: number; distance: number }[];

const keyword = (query: string) =>
  (
    connection.db.$client
      .prepare("select rowid as id from chunks_fts where chunks_fts match ? order by rank")
      .all(query) as { id: number }[]
  ).map((row) => row.id);

const count = (table: string) =>
  (connection.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

describe("record chunks and their search indexes", () => {
  it("finds the nearest chunks of one patient only", () => {
    const a = insertPatient(connection).id;
    const b = insertPatient(connection, { mrn: "FAKE-002" }).id;
    const headache = addChunk(a, "Headache in the morning", 1);
    const platelets = addChunk(a, "Platelets were low", 2);
    addChunk(b, "Other patient's headache", 1);

    const results = nearest(a, 1);

    expect(results.map((r) => r.id)).toEqual([headache, platelets]);
    expect(results[0]?.distance).toBeCloseTo(0); // cosine distance of identical vectors
  });

  it("matches words by their stem", () => {
    const id = addChunk(insertPatient(connection).id, "Mild headaches after temozolomide", 1);

    expect(keyword("headache")).toEqual([id]);
    expect(keyword("temozolomide")).toEqual([id]);
    expect(keyword("dizziness")).toEqual([]);
  });

  it("re-indexes the words when a chunk's text changes", () => {
    const id = addChunk(insertPatient(connection).id, "Headache", 1);

    connection.db.update(recordChunks).set({ text: "Nausea" }).where(eq(recordChunks.id, id)).run();

    expect(keyword("headache")).toEqual([]);
    expect(keyword("nausea")).toEqual([id]);
  });

  it("removes the vector and the words when a chunk or its patient is deleted", () => {
    const a = insertPatient(connection).id;
    const b = insertPatient(connection, { mrn: "FAKE-002" }).id;
    const first = addChunk(a, "Headache", 1);
    addChunk(a, "Nausea", 2);
    addChunk(b, "Fatigue", 3);

    connection.db.delete(recordChunks).where(eq(recordChunks.id, first)).run();
    expect(count("vec_chunks")).toBe(2);
    expect(keyword("headache")).toEqual([]);

    connection.db.delete(patients).where(eq(patients.id, a)).run();
    expect(count("record_chunks")).toBe(1);
    expect(count("vec_chunks")).toBe(1);
    expect(keyword("nausea")).toEqual([]);
    expect(keyword("fatigue")).toHaveLength(1);
  });

  it("allows one chunk per source and position, and only known source types", () => {
    const id = insertPatient(connection).id;
    addChunk(id, "Headache", 1, "s1");

    expect(sqliteErrorCode(() => addChunk(id, "Again", 1, "s1"))).toBe("SQLITE_CONSTRAINT_UNIQUE");
    expect(
      sqliteErrorCode(() =>
        connection.db
          .insert(recordChunks)
          .values({
            patientId: id,
            sourceType: "email" as "symptom",
            sourceId: "x",
            sourceDate: "2026-10-01",
            chunkIndex: 0,
            text: "x",
          })
          .run(),
      ),
    ).toBe("SQLITE_CONSTRAINT_CHECK");
  });

  it("rejects an embedding of the wrong size", () => {
    const id = insertPatient(connection).id;

    expect(() =>
      connection.db.$client
        .prepare("insert into vec_chunks (rowid, patient_id, embedding) values (?, ?, ?)")
        .run(1n, id, new Float32Array(3)),
    ).toThrow(/dimension/i);
  });
});
