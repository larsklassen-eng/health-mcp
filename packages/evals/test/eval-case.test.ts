import { describe, expect, it } from "vitest";

import { EvalCaseSchema, EvalResultSchema } from "../src/index.js";

describe("EvalCaseSchema", () => {
  const base = {
    id: "labs-1",
    description: "Asks for recent labs",
    patientMrn: "FAKE-001",
    userMessage: "Any abnormal labs?",
  };

  it("applies defaults", () => {
    expect(EvalCaseSchema.parse(base)).toMatchObject({
      expectedToolCalls: [],
      forbiddenToolCalls: [],
      answerIncludes: [],
      answerExcludes: [],
      maxToolCalls: 8,
    });
  });

  it.each([
    ["an id with spaces", { id: "labs 1" }],
    ["an empty user message", { userMessage: "" }],
    ["a patient that is not synthetic", { patientMrn: "MRN-123" }],
    ["an unknown tool", { expectedToolCalls: [{ name: "get_everything" }] }],
    ["an empty list of alternatives", { answerIncludes: [[]] }],
  ])("rejects %s", (_label, override) => {
    expect(EvalCaseSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

describe("EvalResultSchema", () => {
  it("accepts a failed result with reasons", () => {
    const result = {
      caseId: "labs-1",
      passed: false,
      toolCalls: [],
      failures: ["Expected a successful call to get_lab_results."],
    };
    expect(EvalResultSchema.parse(result)).toEqual(result);
  });
});
