import { createDb, type DbConnection, migrateDb, patients, symptoms } from "@health-mcp/db";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  HashingEmbedder,
  type Reranker,
  searchPatientChunks,
  syncPatientIndex,
} from "../src/index.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
beforeAll(() => provider.register());
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

let connection: DbConnection;
let patientId: string;
const embedder = new HashingEmbedder();

beforeEach(async () => {
  connection = createDb({ path: ":memory:" });
  migrateDb(connection.db);
  patientId = connection.db
    .insert(patients)
    .values({
      mrn: "FAKE-1",
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      diagnosis: "Synthetic meningioma",
    })
    .returning()
    .get().id;
  for (const [notes, day] of [
    ["Headache behind the eyes, worse in the morning", "01"],
    ["Mild nausea after dinner", "02"],
  ] as const)
    connection.db
      .insert(symptoms)
      .values({
        patientId,
        name: "Symptom",
        severity: 3,
        notes,
        recordedAt: `2026-10-${day}T09:00:00.000Z`,
      })
      .run();
  await syncPatientIndex(connection.db, embedder, patientId);
  exporter.reset();
});
afterEach(() => connection.close());

const spans = () => exporter.getFinishedSpans();
const span = (name: string): ReadableSpan => {
  const found = spans().find((s) => s.name === name);
  if (!found)
    throw new Error(
      `no span ${name} in ${spans()
        .map((s) => s.name)
        .join(", ")}`,
    );
  return found;
};

describe("tracing", () => {
  it("records a search as a retriever span with its stages and passages", async () => {
    const reranker: Reranker = {
      model: "fake-reranker",
      rerank: async (_query, texts) => texts.map((_text, i) => -i),
    };

    const results = await searchPatientChunks(connection.db, embedder, patientId, "headache", {
      reranker,
      minSimilarity: 0,
    });

    const search = span("rag.search");
    expect(search.status.code).toBe(SpanStatusCode.OK);
    expect(search.attributes).toMatchObject({
      "openinference.span.kind": "RETRIEVER",
      "input.value": "headache",
      "rag.patient_id": patientId,
      "rag.k": 5,
      "rag.results": results.length,
    });
    expect(search.attributes["retrieval.documents.0.document.content"]).toBe(results[0]!.text);
    expect(
      JSON.parse(String(search.attributes["retrieval.documents.0.document.metadata"])),
    ).toMatchObject({ sourceType: "symptom", matchedBy: results[0]!.matchedBy });

    for (const [name, kind] of [
      ["rag.embed_query", "EMBEDDING"],
      ["rag.vector_search", "RETRIEVER"],
      ["rag.keyword_search", "RETRIEVER"],
      ["rag.rerank", "RERANKER"],
    ] as const) {
      expect(span(name).attributes["openinference.span.kind"]).toBe(kind);
      expect(span(name).parentSpanContext?.spanId).toBe(search.spanContext().spanId);
    }
    expect(span("rag.embed_query").attributes).toMatchObject({
      "embedding.model_name": "hashing",
      "embedding.embeddings.0.embedding.text": "headache",
    });
    expect(span("rag.vector_search").attributes["rag.candidates"]).toBe(2);
    expect(span("rag.keyword_search").attributes).toMatchObject({ "rag.hits": 1 });
    expect(span("rag.rerank").attributes).toMatchObject({
      "reranker.model_name": "fake-reranker",
      "reranker.query": "headache",
    });
  });

  it("counts what the similarity floor removed", async () => {
    await searchPatientChunks(connection.db, embedder, patientId, "tell me a joke", {
      minSimilarity: 0.99,
    });

    const vector = span("rag.vector_search").attributes;
    expect(vector["rag.kept"]).toBe(0);
    expect(vector["rag.below_min_similarity"]).toBe(vector["rag.candidates"]);
    expect(span("rag.search").attributes["rag.results"]).toBe(0);
  });

  it("records indexing: the sync with its counts, and the passages embedded", async () => {
    connection.db
      .insert(symptoms)
      .values({
        patientId,
        name: "Symptom",
        severity: 2,
        notes: "Blurred vision when reading",
        recordedAt: "2026-10-03T09:00:00.000Z",
      })
      .run();

    await syncPatientIndex(connection.db, embedder, patientId);

    expect(span("rag.sync_patient").attributes).toMatchObject({
      "openinference.span.kind": "CHAIN",
      "rag.patient_id": patientId,
      "rag.records_indexed": 1,
      "rag.records_unchanged": 2,
    });
    const embedded = span("rag.embed_passages");
    expect(embedded.parentSpanContext?.spanId).toBe(span("rag.sync_patient").spanContext().spanId);
    expect(String(embedded.attributes["embedding.embeddings.0.embedding.text"])).toContain(
      "Blurred vision",
    );
  });
});
