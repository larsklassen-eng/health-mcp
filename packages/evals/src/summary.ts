import type { EvalResult } from "./eval-case.js";

/** How one case did over its attempts (`yarn eval --repeat <n>`). */
export interface CaseSummary {
  caseId: string;
  passes: number;
  attempts: number;
}

/**
 * A run's results per case and overall. The model does not answer the same way
 * twice, so one attempt per case cannot tell a regression from bad luck:
 * - `passAll` (pass^k): cases that passed every attempt, what a clinician who
 *   gets one answer can rely on.
 * - `passAny` (pass@k): cases that passed at least once, what the agent can do.
 * A case in `passAny` but not `passAll` is flaky.
 */
export function summarizeAttempts(results: readonly EvalResult[]) {
  const byCase = new Map<string, CaseSummary>();
  for (const result of results) {
    const summary = byCase.get(result.caseId) ?? {
      caseId: result.caseId,
      passes: 0,
      attempts: 0,
    };
    summary.attempts += 1;
    if (result.passed) summary.passes += 1;
    byCase.set(result.caseId, summary);
  }
  const cases = [...byCase.values()];
  return {
    cases,
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    passAll: cases.filter((c) => c.passes === c.attempts).length,
    passAny: cases.filter((c) => c.passes > 0).length,
    flaky: cases.filter((c) => c.passes > 0 && c.passes < c.attempts).map((c) => c.caseId),
  };
}
