import { HashingEmbedder, indexSource, type TextSource } from "@health-mcp/rag";
import { RecordSearchOutputSchema } from "@health-mcp/shared";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertPatient, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer;
let client: Client;
let patientId: string;
beforeEach(async () => {
  server = await startTestServer();
  client = await server.connect();
  patientId = insertPatient(server.db).id;
});
afterEach(async () => {
  await server.close();
});

const call = async (args: Record<string, unknown>, forPatient = patientId) =>
  (await client.callTool({
    name: "search_patient_records",
    arguments: { patient_id: forPatient, ...args },
  })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : "";
const search = async (args: Record<string, unknown>) => {
  const result = await call(args);
  expect(result.isError).toBeFalsy();
  // The shared schema is what the web parses for the chat's search card.
  return RecordSearchOutputSchema.parse(JSON.parse(text(result)));
};

/** Indexes a text as the api would, with the same stand-in embedder the server uses. */
function index(
  source: Omit<TextSource, "sourceDate"> & { sourceDate?: string },
  forPatient = patientId,
) {
  const full = { sourceDate: "2026-10-01", ...source };
  return indexSource(
    server.db,
    new HashingEmbedder(),
    { patientId: forPatient, sourceType: full.sourceType, sourceId: full.sourceId },
    full,
  );
}

describe("search_patient_records", () => {
  it("returns matching passages with their source, date and title", async () => {
    await index({
      sourceType: "symptom",
      sourceId: "y1",
      sourceDate: "2026-10-05",
      title: "Symptom (2026-10-05)",
      text: "Dizziness, severity 3/10. When standing up.",
    });
    await index({
      sourceType: "symptom",
      sourceId: "y2",
      title: "Symptom (2026-10-01)",
      text: "Nausea.",
    });

    const { passages, note } = await search({ query: "dizziness when standing" });

    expect(note).toBeUndefined();
    expect(passages[0]).toMatchObject({
      source: "symptom",
      sourceId: "y1",
      date: "2026-10-05",
      title: "Symptom (2026-10-05)",
      text: "Dizziness, severity 3/10. When standing up.",
      matchedBy: expect.arrayContaining(["keyword"]),
    });
    expect(passages.map((p) => p.sourceId)).not.toContain("y2");
  });

  it("filters by kind of source and limits the number of passages", async () => {
    for (let n = 1; n <= 4; n++)
      await index({
        sourceType: "symptom",
        sourceId: `y${n}`,
        title: "Symptom",
        text: `Headache ${n}.`,
      });
    await index({
      sourceType: "imaging_report",
      sourceId: "s1",
      title: "Imaging report: MRI brain (2026-08-18)",
      text: "Impression: headache not explained by imaging.",
    });

    const reports = await search({ query: "headache", sources: ["imaging_report"] });
    const two = await search({ query: "headache", limit: 2 });

    expect(reports.passages.map((p) => p.source)).toEqual(["imaging_report"]);
    expect(two.passages).toHaveLength(2);
  });

  it("says so when nothing relevant is found", async () => {
    await index({ sourceType: "symptom", sourceId: "y1", title: "Symptom", text: "Headache." });

    expect(await search({ query: "kidney function" })).toEqual({
      passages: [],
      note: "No relevant passages were found in this patient's records.",
    });
  });

  it("never returns another patient's passages", async () => {
    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" }).id;
    await index(
      { sourceType: "symptom", sourceId: "y9", title: "Symptom", text: "Dizziness." },
      other,
    );

    expect((await search({ query: "dizziness" })).passages).toEqual([]);
  });

  it("rejects an unknown patient and invalid arguments", async () => {
    const unknown = await call({ query: "headache" }, "does-not-exist");
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toBe("Patient does-not-exist not found.");

    expect((await call({ query: "x" })).isError).toBe(true);
    expect((await call({ query: "headache", sources: ["email"] })).isError).toBe(true);
    expect((await call({ query: "headache", limit: 11 })).isError).toBe(true);
  });

  it("orders passages by the reranker when the server has one", async () => {
    const reranked = await startTestServer({
      reranker: {
        model: "fake",
        // Prefers the passage about standing up, whatever the search order was.
        rerank: async (_query, texts) => texts.map((text) => (text.includes("standing") ? 9 : 1)),
      },
    });
    try {
      const otherPatient = insertPatient(reranked.db).id;
      for (const [sourceId, text] of [
        ["y1", "Dizziness, severity 5/10. Dizziness all morning, dizziness at night."],
        ["y2", "Dizziness, severity 2/10. When standing up."],
      ] as const)
        await indexSource(
          reranked.db,
          new HashingEmbedder(),
          { patientId: otherPatient, sourceType: "symptom", sourceId },
          { sourceType: "symptom", sourceId, sourceDate: "2026-10-01", title: "Symptom", text },
        );
      const result = (await (
        await reranked.connect()
      ).callTool({
        name: "search_patient_records",
        arguments: { patient_id: otherPatient, query: "dizziness" },
      })) as CallToolResult;

      const { passages } = RecordSearchOutputSchema.parse(JSON.parse(text(result)));
      expect(passages.map((p) => p.sourceId)).toEqual(["y2", "y1"]);
    } finally {
      await reranked.close();
    }
  });

  it("is not offered when the server has no embedder", async () => {
    const plain = await startTestServer({ embedder: null });
    try {
      const { tools } = await (await plain.connect()).listTools();
      expect(tools.map((t) => t.name)).not.toContain("search_patient_records");
    } finally {
      await plain.close();
    }
  });
});
