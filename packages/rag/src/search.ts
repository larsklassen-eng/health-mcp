import type { HealthDb } from "@health-mcp/db";
import type { ChunkSourceType } from "@health-mcp/shared";
import { trace } from "@opentelemetry/api";

import type { Embedder } from "./embedder.js";
import type { Reranker } from "./reranker.js";
import { documentAttributes, embeddingTextAttributes, inSpan, SC, SpanKind } from "./telemetry.js";

/*
 * Hybrid search over one patient's chunks. Vector search finds passages with
 * the same meaning ("head pain" → "headache"); keyword search finds exact
 * terms the model may not know well (drug names, "FLAIR"). The two ranked
 * lists are merged with reciprocal rank fusion. A reranker, when given, then
 * re-orders the best of them by reading each passage with the question.
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
  /**
   * Re-orders the best candidates (after the similarity filter, which still
   * decides what counts as relevant: reranker scores do not separate
   * off-topic questions reliably).
   */
  reranker?: Reranker;
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
  /** The reranker's score (a logit), when one was used: higher is more relevant. */
  rerankScore?: number;
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
/** Candidates the reranker re-scores; 20 found as much as 40 on the retrieval checks. */
const RERANK_CANDIDATES = 20;

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

export function searchPatientChunks(
  db: HealthDb,
  embedder: Embedder,
  patientId: string,
  query: string,
  { k = 5, sources, minSimilarity = DEFAULT_MIN_SIMILARITY, reranker }: SearchOptions = {},
): Promise<SearchResult[]> {
  return inSpan(
    "rag.search",
    SpanKind.RETRIEVER,
    {
      [SC.INPUT_VALUE]: query,
      "rag.patient_id": patientId,
      "rag.k": k,
      "rag.min_similarity": minSimilarity,
      ...(sources && { "rag.sources": sources.join(",") }),
    },
    async (span) => {
      const results = await search(db, embedder, patientId, query, {
        k,
        sources,
        minSimilarity,
        reranker,
      });
      span.setAttributes({
        "rag.results": results.length,
        ...documentAttributes(
          SC.RETRIEVAL_DOCUMENTS,
          results.map((result) => ({
            id: result.chunkId,
            content: result.text,
            score: result.rerankScore ?? result.score,
            metadata: {
              sourceType: result.sourceType,
              sourceId: result.sourceId,
              sourceDate: result.sourceDate,
              similarity: result.similarity,
              matchedBy: result.matchedBy,
              rrfScore: result.score,
              rerankScore: result.rerankScore,
            },
          })),
        ),
      });
      return results;
    },
  );
}

/** {@link SearchOptions} with the defaults filled in. */
interface ResolvedOptions {
  k: number;
  sources: readonly ChunkSourceType[] | undefined;
  minSimilarity: number;
  reranker: Reranker | undefined;
}

async function search(
  db: HealthDb,
  embedder: Embedder,
  patientId: string,
  query: string,
  { k, sources, minSimilarity, reranker }: ResolvedOptions,
): Promise<SearchResult[]> {
  const sqlite = db.$client;
  const vector = await inSpan(
    "rag.embed_query",
    SpanKind.EMBEDDING,
    embeddingTextAttributes(embedder.model, [query]),
    () => embedder.embedQuery(query),
  );

  // Nearest neighbours among this patient's vectors only (patient_id is the partition key).
  const nearest = await inSpan("rag.vector_search", SpanKind.RETRIEVER, {}, (span) => {
    const rows = sqlite
      .prepare(
        "select rowid as id, distance from vec_chunks " +
          "where embedding match ? and k = ? and patient_id = ? order by distance",
      )
      .all(vector, CANDIDATES, patientId) as { id: number; distance: number }[];
    const kept = rows.filter(({ distance }) => 1 - distance >= minSimilarity).length;
    span.setAttributes({
      "rag.candidates": rows.length,
      "rag.kept": kept,
      "rag.below_min_similarity": rows.length - kept,
      ...(rows[0] && { "rag.best_similarity": 1 - rows[0].distance }),
      ...documentAttributes(
        SC.RETRIEVAL_DOCUMENTS,
        rows.map(({ id, distance }) => ({ id, score: 1 - distance })),
      ),
    });
    return rows;
  });

  const words = keywordQuery(query);
  const keywordHits = await inSpan(
    "rag.keyword_search",
    SpanKind.RETRIEVER,
    { "rag.fts_query": words ?? "" },
    (span) => {
      const rows = words
        ? (sqlite
            .prepare(
              "select c.id from chunks_fts f join record_chunks c on c.id = f.rowid " +
                "where chunks_fts match ? and c.patient_id = ? order by bm25(chunks_fts) limit ?",
            )
            .all(words, patientId, CANDIDATES) as { id: number }[])
        : [];
      span.setAttributes({
        "rag.hits": rows.length,
        ...documentAttributes(SC.RETRIEVAL_DOCUMENTS, rows),
      });
      return rows;
    },
  );

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
  const parent = trace.getActiveSpan();
  parent?.setAttributes({
    "rag.merged": merged.size,
    "rag.found_by_both": [...merged.values()].filter((entry) => entry.matchedBy.length === 2)
      .length,
  });
  if (merged.size === 0) return [];

  const ids = [...merged.keys()];
  const rows = sqlite
    .prepare(
      "select id, source_type, source_id, source_date, text from record_chunks " +
        `where id in (${ids.map(() => "?").join(", ")})`,
    )
    .all(...ids) as ChunkRow[];

  const ranked: SearchResult[] = rows
    .filter((row) => !sources || sources.includes(row.source_type))
    .map((row) => ({
      chunkId: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceDate: row.source_date,
      text: row.text,
      ...merged.get(row.id)!,
    }))
    .sort((a, b) => b.score - a.score || a.chunkId - b.chunkId);
  if (!reranker || ranked.length === 0) return ranked.slice(0, k);

  const candidates = ranked.slice(0, RERANK_CANDIDATES);
  return inSpan(
    "rag.rerank",
    SpanKind.RERANKER,
    {
      [SC.RERANKER_QUERY]: query,
      [SC.RERANKER_MODEL_NAME]: reranker.model,
      [SC.RERANKER_TOP_K]: k,
      ...documentAttributes(
        SC.RERANKER_INPUT_DOCUMENTS,
        candidates.map((result) => ({
          id: result.chunkId,
          content: result.text,
          score: result.score,
        })),
      ),
    },
    async (span) => {
      const scores = await reranker.rerank(
        query,
        candidates.map((result) => result.text),
      );
      const reranked = candidates
        .map((result, index) => ({ ...result, rerankScore: scores[index]! }))
        .sort((a, b) => b.rerankScore - a.rerankScore || b.score - a.score)
        .slice(0, k);
      span.setAttributes({
        "rag.top_changed": reranked[0]?.chunkId !== candidates[0]?.chunkId,
        ...documentAttributes(
          SC.RERANKER_OUTPUT_DOCUMENTS,
          reranked.map((result) => ({ id: result.chunkId, score: result.rerankScore })),
        ),
      });
      return reranked;
    },
  );
}
