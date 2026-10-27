import type { HealthDb } from "@health-mcp/db";
import type { ChunkSourceType } from "@health-mcp/shared";

import type { Embedder } from "./embedder.js";

/*
 * Hybrid search over one patient's chunks. Vector search finds passages with
 * the same meaning ("head pain" → "headache"); keyword search finds exact
 * terms the model may not know well (drug names, "FLAIR"). The two ranked
 * lists are merged with reciprocal rank fusion.
 */

export interface SearchOptions {
  /** Results to return. */
  k?: number;
  /** Only these kinds of sources. */
  sources?: readonly ChunkSourceType[];
  /**
   * A passage found only by vector search must be at least this similar
   * (cosine, 0–1) to the query. Keyword matches always count. Without this,
   * vector search would return the "nearest" passages even when none is relevant.
   */
  minSimilarity?: number;
}

export interface SearchResult {
  chunkId: number;
  sourceType: ChunkSourceType;
  sourceId: string;
  sourceDate: string;
  text: string;
  /** Reciprocal rank fusion score: higher is better; only meaningful within one search. */
  score: number;
  /** Cosine similarity to the query, when vector search found the passage. */
  similarity?: number;
  /** Which searches found the passage. */
  matchedBy: ("vector" | "keyword")[];
}

/**
 * Removes passages for off-topic questions. Measured on the synthetic patients
 * with bge-small-en-v1.5: off-topic questions ("tell me a joke") reached at most
 * 0.561, the weakest real match 0.587 ("trouble seeing" → blurred vision). Between
 * related medical topics scores overlap (0.66 for "dizziness" → "trouble
 * concentrating"), so the model still judges relevance from the passages.
 */
export const DEFAULT_MIN_SIMILARITY = 0.57;
/** Candidates taken from each search before merging. */
const CANDIDATES = 30;
/** The usual RRF constant: damps the difference between the first few ranks. */
const RRF_K = 60;

/** Words that would match almost every passage. */
const STOP_WORDS = new Set(
  (
    "a an and any are as at be been but by can did do does for from had has have he her his how " +
    "i in is it its me my of on or our she so that the their them there they this to was we were " +
    "what when where which who why will with you your"
  ).split(" "),
);

/** An FTS5 query that matches any of the meaningful words, quoted so punctuation is safe. */
export function keywordQuery(query: string): string | undefined {
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP_WORDS.has(w));
  return words.length === 0 ? undefined : [...new Set(words)].map((w) => `"${w}"`).join(" OR ");
}

interface ChunkRow {
  id: number;
  source_type: ChunkSourceType;
  source_id: string;
  source_date: string;
  text: string;
}

export async function searchPatientChunks(
  db: HealthDb,
  embedder: Embedder,
  patientId: string,
  query: string,
  { k = 5, sources, minSimilarity = DEFAULT_MIN_SIMILARITY }: SearchOptions = {},
): Promise<SearchResult[]> {
  const sqlite = db.$client;
  const vector = await embedder.embedQuery(query);

  // Nearest neighbours among this patient's vectors only (patient_id is the partition key).
  const nearest = sqlite
    .prepare(
      "select rowid as id, distance from vec_chunks " +
        "where embedding match ? and k = ? and patient_id = ? order by distance",
    )
    .all(vector, CANDIDATES, patientId) as { id: number; distance: number }[];

  const words = keywordQuery(query);
  const keywordHits = words
    ? (sqlite
        .prepare(
          "select c.id from chunks_fts f join record_chunks c on c.id = f.rowid " +
            "where chunks_fts match ? and c.patient_id = ? order by bm25(chunks_fts) limit ?",
        )
        .all(words, patientId, CANDIDATES) as { id: number }[])
    : [];

  const merged = new Map<number, Pick<SearchResult, "score" | "similarity" | "matchedBy">>();
  nearest.forEach(({ id, distance }, rank) => {
    const similarity = 1 - distance;
    if (similarity < minSimilarity) return;
    merged.set(id, { score: 1 / (RRF_K + rank + 1), similarity, matchedBy: ["vector"] });
  });
  keywordHits.forEach(({ id }, rank) => {
    const entry = merged.get(id) ?? { score: 0, matchedBy: [] };
    entry.score += 1 / (RRF_K + rank + 1);
    entry.matchedBy.push("keyword");
    merged.set(id, entry);
  });
  if (merged.size === 0) return [];

  const ids = [...merged.keys()];
  const rows = sqlite
    .prepare(
      "select id, source_type, source_id, source_date, text from record_chunks " +
        `where id in (${ids.map(() => "?").join(", ")})`,
    )
    .all(...ids) as ChunkRow[];

  return rows
    .filter((row) => !sources || sources.includes(row.source_type))
    .map((row) => ({
      chunkId: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceDate: row.source_date,
      text: row.text,
      ...merged.get(row.id)!,
    }))
    .sort((a, b) => b.score - a.score || a.chunkId - b.chunkId)
    .slice(0, k);
}
