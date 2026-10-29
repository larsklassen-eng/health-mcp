import { ChunkSourceTypeSchema } from "@health-mcp/shared";
import { z } from "zod";

/**
 * One retrieval check: a search over a synthetic patient's indexed text, and
 * the passage that must come back in the top `k`. Runs with the real embedding
 * model and no LLM, so it is free (`yarn eval:retrieval`).
 */
export const RetrievalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** MRN of a patient in the synthetic fixture. */
  patientMrn: z.string().startsWith("FAKE-"),
  query: z.string().min(2),
  /** The passage to find: its source and a phrase from it. Omit when nothing is relevant. */
  expected: z.object({ source: ChunkSourceTypeSchema, textIncludes: z.string().min(1) }).optional(),
  k: z.int().min(1).max(10).default(5),
});

export type RetrievalCase = z.infer<typeof RetrievalCaseSchema>;
export type RetrievalCaseInput = z.input<typeof RetrievalCaseSchema>;

/** A search result, as `searchPatientChunks` in @health-mcp/rag returns it. */
export interface RetrievedPassage {
  sourceType: string;
  text: string;
  similarity?: number;
}

export interface RetrievalResult {
  caseId: string;
  passed: boolean;
  /** Position of the expected passage (1 = first); absent when it was not found. */
  rank?: number;
  failures: string[];
  /** What came back, best first: source, similarity and the start of the text. */
  retrieved: string[];
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

const describePassage = ({ sourceType, text, similarity }: RetrievedPassage) => {
  const body = text.split("\n").slice(1).join(" ");
  const score = similarity === undefined ? "keyword" : similarity.toFixed(2);
  return `${sourceType} (${score}): ${body.length > 80 ? `${body.slice(0, 80)}…` : body}`;
};

/** Checks one search's results against a case. */
export function gradeRetrieval(
  retrievalCase: RetrievalCase,
  results: RetrievedPassage[],
): RetrievalResult {
  const { expected, k } = retrievalCase;
  const top = results.slice(0, k);
  const failures: string[] = [];
  let rank: number | undefined;

  if (expected) {
    const index = top.findIndex(
      (passage) =>
        passage.sourceType === expected.source &&
        normalize(passage.text).includes(normalize(expected.textIncludes)),
    );
    if (index === -1)
      failures.push(
        `Expected a ${expected.source} passage with "${expected.textIncludes}" in the top ${k}.`,
      );
    else rank = index + 1;
  } else if (top.length > 0) {
    failures.push(`Expected no passages, got ${top.length}.`);
  }

  return {
    caseId: retrievalCase.id,
    passed: failures.length === 0,
    ...(rank !== undefined && { rank }),
    failures,
    retrieved: top.map(describePassage),
  };
}

/**
 * Hit rate (share of cases with an expected passage that found it in the top k)
 * and mean reciprocal rank (1 when it is always first, 0 when never found).
 */
export function summarizeRetrieval(cases: RetrievalCase[], results: RetrievalResult[]) {
  const withExpected = results.filter((result) =>
    cases.some((c) => c.id === result.caseId && c.expected),
  );
  const hits = withExpected.filter((result) => result.rank !== undefined).length;
  const reciprocal = withExpected.reduce(
    (sum, result) => sum + (result.rank ? 1 / result.rank : 0),
    0,
  );
  const count = withExpected.length;
  return {
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    hitRate: count === 0 ? 0 : hits / count,
    meanReciprocalRank: count === 0 ? 0 : reciprocal / count,
  };
}
