import { describe, expect, it } from "vitest";

import { type EvalResult, summarizeAttempts } from "../src/index.js";

const result = (caseId: string, passed: boolean): EvalResult => ({
  caseId,
  passed,
  toolCalls: [],
  failures: passed ? [] : ["The answer is empty."],
  ungroundedNumbers: [],
});

describe("summarizeAttempts", () => {
  it("counts each case's passes and tells reliable, flaky and failing cases apart", () => {
    const summary = summarizeAttempts([
      result("steady", true),
      result("steady", true),
      result("flaky", true),
      result("flaky", false),
      result("broken", false),
      result("broken", false),
    ]);

    expect(summary).toEqual({
      cases: [
        { caseId: "steady", passes: 2, attempts: 2 },
        { caseId: "flaky", passes: 1, attempts: 2 },
        { caseId: "broken", passes: 0, attempts: 2 },
      ],
      passed: 3,
      total: 6,
      passAll: 1,
      passAny: 2,
      flaky: ["flaky"],
    });
  });
});
