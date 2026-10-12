import { describe, expect, it } from "vitest";

import { EvalCaseSchema, EvalResultSchema } from "../src/index.js";

describe("EvalCaseSchema", () => {
  const base = { id: "labs-1", description: "Asks for recent labs", patientId: "FAKE-001", userMessage: "Any abnormal labs?" };

  it("defaults expectedToolCalls to an empty list", () => {
    expect(EvalCaseSchema.parse(base).expectedToolCalls).toEqual([]);
  });

  it.each([
    ["an empty id", { id: "" }],
    ["an empty user message", { userMessage: "" }],
    ["a missing patient", { patientId: undefined }],
  ])("rejects %s", (_label, override) => {
    expect(EvalCaseSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

describe("EvalResultSchema", () => {
  it("accepts a failed result with reasons", () => {
    const result = { caseId: "labs-1", passed: false, toolCalls: [], failures: ["get_lab_results was not called"] };
    expect(EvalResultSchema.parse(result)).toEqual(result);
  });
});
