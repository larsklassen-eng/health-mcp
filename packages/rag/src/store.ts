import type { HealthDb } from "@health-mcp/db";
import type { ChunkSourceType } from "@health-mcp/shared";

import type { ChunkOptions } from "./chunker.js";
import type { Embedder } from "./embedder.js";
import { chunkSource, type TextSource } from "./sources.js";

/** The record a source's chunks belong to. */
export interface SourceRef {
  patientId: string;
  sourceType: ChunkSourceType;
  sourceId: string;
}

/**
 * Makes the index match one record: its old chunks are replaced by the chunks
 * of `source`, or removed when `source` is `undefined` (e.g. notes cleared).
 * Embedding happens first; the database change is one transaction, so a
 * search never sees half of a record. Returns the number of chunks stored.
 */
export async function indexSource(
  db: HealthDb,
  embedder: Embedder,
  ref: SourceRef,
  source: TextSource | undefined,
  options?: ChunkOptions,
): Promise<number> {
  const chunks = source ? chunkSource(source, options) : [];
  const vectors = await embedder.embedDocuments(chunks.map((chunk) => chunk.text));

  const sqlite = db.$client;
  const remove = sqlite.prepare(
    "delete from record_chunks where source_type = ? and source_id = ?",
  );
  const insertChunk = sqlite.prepare(
    "insert into record_chunks " +
      "(patient_id, source_type, source_id, source_date, chunk_index, text) " +
      "values (?, ?, ?, ?, ?, ?)",
  );
  const insertVector = sqlite.prepare(
    "insert into vec_chunks (rowid, patient_id, embedding) values (?, ?, ?)",
  );

  sqlite.transaction(() => {
    // The delete trigger also removes the old vectors and keyword entries.
    remove.run(ref.sourceType, ref.sourceId);
    chunks.forEach((chunk, i) => {
      const { lastInsertRowid } = insertChunk.run(
        ref.patientId,
        ref.sourceType,
        ref.sourceId,
        chunk.sourceDate,
        chunk.chunkIndex,
        chunk.text,
      );
      insertVector.run(BigInt(lastInsertRowid), ref.patientId, vectors[i]!);
    });
  })();
  return chunks.length;
}
