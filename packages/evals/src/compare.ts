import { z } from "zod";

/*
 * Compares two eval reports (from eval-results/): which cases changed, and
 * what else differed between the runs (model, code, prompt, tools). Reads the
 * reports loosely, so reports written before a field existed still compare.
 */

const ProvenanceSchema = z
  .object({
    gitCommit: z.string().optional(),
    gitDirty: z.boolean().optional(),
    systemPromptHash: z.string().optional(),
    toolsHash: z.string().optional(),
  })
  .partial();

export const AgentReportSchema = z.object({
  model: z.string().optional(),
  judgeModel: z.string().optional(),
  repeat: z.number().optional(),
  provenance: ProvenanceSchema.optional(),
  usage: z.object({ costUsd: z.number().optional() }).optional(),
  results: z.array(
    z.object({
      caseId: z.string(),
      passed: z.boolean(),
      failures: z.array(z.string()).default([]),
      usage: z.object({ costUsd: z.number().optional() }).optional(),
    }),
  ),
});
export type AgentReport = z.infer<typeof AgentReportSchema>;

export const RetrievalReportSchema = z.object({
  provenance: ProvenanceSchema.optional(),
  embeddingModel: z.string().optional(),
  rerankerModel: z.string().nullable().optional(),
  minSimilarity: z.number().optional(),
  results: z.array(
    z.object({
      caseId: z.string(),
      passed: z.boolean(),
      rank: z.number().optional(),
      recall: z.number().optional(),
      failures: z.array(z.string()).default([]),
    }),
  ),
});
export type RetrievalReport = z.infer<typeof RetrievalReportSchema>;

/** A setting that differs between the two runs. */
export interface SettingChange {
  name: string;
  before: string;
  after: string;
}

const show = (value: unknown) =>
  value === undefined || value === null ? "(not recorded)" : String(value);

function settingChanges(pairs: [string, unknown, unknown][]): SettingChange[] {
  return pairs
    .filter(([, before, after]) => show(before) !== show(after))
    .map(([name, before, after]) => ({ name, before: show(before), after: show(after) }));
}

const provenancePairs = (
  a: z.infer<typeof ProvenanceSchema> = {},
  b: z.infer<typeof ProvenanceSchema> = {},
): [string, unknown, unknown][] => [
  ["git commit", a.gitCommit?.slice(0, 7), b.gitCommit?.slice(0, 7)],
  ["uncommitted changes", a.gitDirty, b.gitDirty],
  ["system prompt", a.systemPromptHash, b.systemPromptHash],
  ["tool definitions", a.toolsHash, b.toolsHash],
];

// ---------------------------------------------------------------- agent eval

export interface AgentOutcome {
  passes: number;
  attempts: number;
  /** The failures of the attempts that failed, each once. */
  failures: string[];
}

export type AgentChangeKind = "broke" | "fixed" | "worse" | "better" | "added" | "removed";

export interface AgentChange {
  caseId: string;
  kind: AgentChangeKind;
  before?: AgentOutcome;
  after?: AgentOutcome;
}

/** Each case's passes over its attempts (one attempt per result). */
export function agentOutcomes(report: AgentReport): Map<string, AgentOutcome> {
  const outcomes = new Map<string, AgentOutcome>();
  for (const result of report.results) {
    const outcome = outcomes.get(result.caseId) ?? { passes: 0, attempts: 0, failures: [] };
    outcome.attempts += 1;
    if (result.passed) outcome.passes += 1;
    for (const failure of result.failures)
      if (!outcome.failures.includes(failure)) outcome.failures.push(failure);
    outcomes.set(result.caseId, outcome);
  }
  return outcomes;
}

const rate = (o: AgentOutcome) => o.passes / o.attempts;
const allPassed = (o: AgentOutcome) => o.passes === o.attempts;

function agentChange(before?: AgentOutcome, after?: AgentOutcome): AgentChangeKind | undefined {
  if (!before) return "added";
  if (!after) return "removed";
  if (allPassed(before) && !allPassed(after)) return "broke";
  if (!allPassed(before) && allPassed(after)) return "fixed";
  if (rate(after) < rate(before)) return "worse";
  if (rate(after) > rate(before)) return "better";
  return undefined;
}

/** Order in which changes are listed: what needs attention first. */
const KIND_ORDER: AgentChangeKind[] = ["broke", "worse", "fixed", "better", "added", "removed"];

export function compareAgentReports(a: AgentReport, b: AgentReport) {
  const before = agentOutcomes(a);
  const after = agentOutcomes(b);
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const changes: AgentChange[] = [];
  for (const caseId of ids) {
    const kind = agentChange(before.get(caseId), after.get(caseId));
    if (kind)
      changes.push({
        caseId,
        kind,
        ...(before.has(caseId) && { before: before.get(caseId)! }),
        ...(after.has(caseId) && { after: after.get(caseId)! }),
      });
  }
  changes.sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
  const totals = (outcomes: Map<string, AgentOutcome>, report: AgentReport) => ({
    cases: outcomes.size,
    passAll: [...outcomes.values()].filter(allPassed).length,
    attempts: report.results.length,
    passedAttempts: report.results.filter((r) => r.passed).length,
    costUsd: report.usage?.costUsd,
  });
  return {
    provenanceRecorded: Boolean(a.provenance && b.provenance),
    settings: settingChanges([
      ["model", a.model, b.model],
      ["judge model", a.judgeModel, b.judgeModel],
      ["repeat", a.repeat ?? 1, b.repeat ?? 1],
      ...provenancePairs(a.provenance, b.provenance),
    ]),
    before: totals(before, a),
    after: totals(after, b),
    changes,
    unchanged: ids.length - changes.length,
  };
}

// ------------------------------------------------------------ retrieval eval

/** One check's result, as a retrieval report has it. */
export type RetrievalOutcome = RetrievalReport["results"][number];

export interface RetrievalChange {
  caseId: string;
  /** What changed, e.g. "rank 1 → 3", "now fails". */
  what: string[];
  /** Whether the change is for the worse (listed first). */
  worse: boolean;
  after?: RetrievalOutcome;
}

const describeRank = (rank?: number) => (rank === undefined ? "not found" : String(rank));
const describeRecall = (recall?: number) =>
  recall === undefined ? "-" : `${Math.round(recall * 100)}%`;

export function compareRetrievalReports(a: RetrievalReport, b: RetrievalReport) {
  const before = new Map(a.results.map((r) => [r.caseId, r]));
  const after = new Map(b.results.map((r) => [r.caseId, r]));
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const changes: RetrievalChange[] = [];
  for (const caseId of ids) {
    const x = before.get(caseId);
    const y = after.get(caseId);
    if (!x || !y) {
      changes.push({
        caseId,
        what: [x ? "removed" : "added"],
        worse: false,
        ...(y && { after: y }),
      });
      continue;
    }
    const what: string[] = [];
    let worse = false;
    if (x.passed !== y.passed) {
      what.push(y.passed ? "now passes" : "now fails");
      worse ||= !y.passed;
    }
    if (x.rank !== y.rank) {
      what.push(`rank ${describeRank(x.rank)} → ${describeRank(y.rank)}`);
      worse ||= y.rank === undefined || (x.rank !== undefined && y.rank > x.rank);
    }
    // Reports from before recall existed have none: nothing to compare.
    if (x.recall !== undefined && y.recall !== undefined && x.recall !== y.recall) {
      what.push(`recall ${describeRecall(x.recall)} → ${describeRecall(y.recall)}`);
      worse ||= y.recall < x.recall;
    }
    if (what.length > 0) changes.push({ caseId, what, worse, after: y });
  }
  changes.sort((x, y) => Number(y.worse) - Number(x.worse));
  const totals = (report: RetrievalReport) => ({
    cases: report.results.length,
    passed: report.results.filter((r) => r.passed).length,
  });
  return {
    provenanceRecorded: Boolean(a.provenance && b.provenance),
    settings: settingChanges([
      ["embedding model", a.embeddingModel, b.embeddingModel],
      ["reranker", a.rerankerModel, b.rerankerModel],
      ["similarity cutoff", a.minSimilarity, b.minSimilarity],
      ...provenancePairs(a.provenance, b.provenance),
    ]),
    before: totals(a),
    after: totals(b),
    changes,
    unchanged: ids.length - changes.length,
  };
}
