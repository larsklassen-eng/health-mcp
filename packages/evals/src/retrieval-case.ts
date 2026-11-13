import { ChunkSourceTypeSchema } from "@health-mcp/shared";
import { z } from "zod";

/** A passage in a patient's index: its source and a phrase from it. */
export const PassageSchema = z.object({
  source: ChunkSourceTypeSchema,
  textIncludes: z.string().min(1),
});

/**
 * One retrieval check: a search over a synthetic patient's indexed text, and
 * what must (or must not) come back in the top `k`. Runs with the real
 * embedding model and no LLM, so it is free (`yarn eval:retrieval`).
 */
export const RetrievalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** MRN of a patient in the synthetic fixture. */
    patientMrn: z.string().startsWith("FAKE-"),
    query: z.string().min(2),
    /** Every passage that answers the query. At least one must be in the top k. */
    relevant: z.array(PassageSchema).default([]),
    /** Nothing in the records is relevant: the search must return nothing. */
    offTopic: z.boolean().default(false),
    /** Text only another patient has, which must never come back (patient isolation). */
    otherPatientText: z.array(z.string().min(1)).default([]),
    /**
     * `tuning`: used to choose the chunk size, the similarity cutoff and the
     * models, so its scores flatter the search. `holdout`: never tuned on; the
     * honest measure. Keep tuning on `tuning` only.
     */
    split: z.enum(["tuning", "holdout"]),
    k: z.int().min(1).max(10).default(5),
  })
  .refine((c) => c.relevant.length > 0 || c.offTopic || c.otherPatientText.length > 0, {
    message: "A case needs relevant passages, offTopic or otherPatientText.",
  })
  .refine((c) => !(c.offTopic && c.relevant.length > 0), {
    message: "An off-topic case has no relevant passages.",
  });

export type RetrievalCase = z.infer<typeof RetrievalCaseSchema>;
export type RetrievalCaseInput = z.input<typeof RetrievalCaseSchema>;

/** A search result, as `searchPatientChunks` in @health-mcp/rag returns it. */
export interface RetrievedPassage {
  sourceType: string;
  text: string;
  similarity?: number;
  /** The patient whose index the passage is in (looked up by the runner). */
  patientId?: string;
}

export interface RetrievalResult {
  caseId: string;
  passed: boolean;
  /** Position of the first relevant passage (1 = first); absent when none was found. */
  rank?: number;
  /** Share of the relevant passages found in the top k; absent without relevant passages. */
  recall?: number;
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

const matches = (passage: RetrievedPassage, expected: z.infer<typeof PassageSchema>) =>
  passage.sourceType === expected.source &&
  normalize(passage.text).includes(normalize(expected.textIncludes));

/** Checks one search's results against a case. `patientId` is the patient searched. */
export function gradeRetrieval(
  retrievalCase: RetrievalCase,
  results: RetrievedPassage[],
  patientId?: string,
): RetrievalResult {
  const { relevant, offTopic, otherPatientText, k } = retrievalCase;
  const top = results.slice(0, k);
  const failures: string[] = [];
  let rank: number | undefined;
  let recall: number | undefined;

  if (relevant.length > 0) {
    const ranks = relevant
      .map((expected) => top.findIndex((passage) => matches(passage, expected)))
      .filter((index) => index !== -1)
      .map((index) => index + 1);
    recall = ranks.length / relevant.length;
    if (ranks.length > 0) rank = Math.min(...ranks);
    else if (relevant.length === 1)
      failures.push(
        `Expected a ${relevant[0]!.source} passage with "${relevant[0]!.textIncludes}" ` +
          `in the top ${k}.`,
      );
    else
      failures.push(
        `Expected at least one of ${relevant.length} relevant passages in the top ${k}.`,
      );
  }
  if (offTopic && top.length > 0) failures.push(`Expected no passages, got ${top.length}.`);

  // Patient isolation, checked on every search: the strongest guarantee, so never skipped.
  for (const [i, passage] of top.entries()) {
    if (patientId !== undefined && passage.patientId !== patientId)
      failures.push(`Passage ${i + 1} belongs to another patient.`);
    const leaked = otherPatientText.find((text) =>
      normalize(passage.text).includes(normalize(text)),
    );
    if (leaked) failures.push(`Passage ${i + 1} has another patient's text: "${leaked}".`);
  }

  return {
    caseId: retrievalCase.id,
    passed: failures.length === 0,
    ...(rank !== undefined && { rank }),
    ...(recall !== undefined && { recall }),
    failures,
    retrieved: top.map(describePassage),
  };
}

export interface RetrievalSummary {
  passed: number;
  total: number;
  /** Share of cases with relevant passages that found at least one in the top k. */
  hitRate: number;
  /** Mean share of each case's relevant passages found in the top k. */
  recall: number;
  /** Mean reciprocal rank of the first relevant passage (1 = always first, 0 = never found). */
  meanReciprocalRank: number;
  /** Off-topic cases that correctly returned nothing, of all off-topic cases. */
  offTopicPassed: number;
  offTopicTotal: number;
}

/** The measures over a set of cases (all, or one split). */
export function summarizeRetrieval(
  cases: readonly RetrievalCase[],
  results: readonly RetrievalResult[],
): RetrievalSummary {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const mine = results.filter((result) => byId.has(result.caseId));
  const withRelevant = mine.filter((result) => byId.get(result.caseId)!.relevant.length > 0);
  const offTopic = mine.filter((result) => byId.get(result.caseId)!.offTopic);
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    passed: mine.filter((result) => result.passed).length,
    total: mine.length,
    hitRate: mean(withRelevant.map((result) => (result.rank === undefined ? 0 : 1))),
    recall: mean(withRelevant.map((result) => result.recall ?? 0)),
    meanReciprocalRank: mean(withRelevant.map((result) => (result.rank ? 1 / result.rank : 0))),
    offTopicPassed: offTopic.filter((result) => result.passed).length,
    offTopicTotal: offTopic.length,
  };
}

/** Where a check starts or stops passing as the similarity cutoff rises (from `--sweep`). */
export interface CutoffEdge {
  caseId: string;
  /** "passes up to": finds its passage up to `cutoff`. "passes from": off-topic, empty from it. */
  kind: "passes up to" | "passes from";
  cutoff: number;
}

/**
 * The cutoffs at which every check with an edge passes: above the highest
 * "passes from", up to the lowest "passes up to"; undefined when there is no
 * such cutoff, or no edge on one side. The middle leaves the most margin both ways.
 */
export function cutoffWindow(edges: readonly CutoffEdge[]) {
  const from = edges.filter((e) => e.kind === "passes from").map((e) => e.cutoff);
  const upTo = edges.filter((e) => e.kind === "passes up to").map((e) => e.cutoff);
  if (from.length === 0 || upTo.length === 0) return undefined;
  const low = Math.max(...from);
  const high = Math.min(...upTo);
  if (low > high) return undefined;
  return { low, high, middle: (low + high) / 2 };
}
