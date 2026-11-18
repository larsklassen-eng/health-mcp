import type { HealthDb } from "@health-mcp/db";
import { type Embedder, type Reranker, searchPatientChunks } from "@health-mcp/rag";
import type { RecordSearchOutput } from "@health-mcp/shared";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

/** Each chunk starts with its source's title line: the title, and the text after it. */
const splitTitle = (chunk: string): [string, string] => {
  const [title = "", ...lines] = chunk.split("\n");
  return [title, lines.join("\n")];
};

/**
 * Hybrid search over the patient's indexed free text (see packages/rag). Only
 * this patient's chunks are searched; the index is kept up to date by apps/api.
 */
export const searchPatientRecords =
  (
    db: HealthDb,
    embedder: Embedder,
    reranker?: Reranker | null,
  ): ToolHandler<"search_patient_records"> =>
  async ({ patient_id, query, sources, limit }): Promise<RecordSearchOutput> => {
    requirePatient(db, patient_id);
    const results = await searchPatientChunks(db, embedder, patient_id, query, {
      k: limit,
      ...(sources && { sources }),
      ...(reranker && { reranker }),
    });
    if (results.length === 0)
      return { passages: [], note: "No relevant passages were found in this patient's records." };

    return {
      passages: results.map((result) => {
        const [title, text] = splitTitle(result.text);
        return {
          source: result.sourceType,
          sourceId: result.sourceId,
          date: result.sourceDate,
          title,
          text,
          ...(result.similarity !== undefined && {
            similarity: Math.round(result.similarity * 100) / 100,
          }),
          matchedBy: result.matchedBy,
          ...(result.otherEntries && {
            otherEntries: result.otherEntries.map((entry) => ({
              sourceId: entry.sourceId,
              date: entry.sourceDate,
              text: splitTitle(entry.text)[1],
            })),
          }),
        };
      }),
    };
  };
