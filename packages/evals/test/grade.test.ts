import { describe, expect, it } from "vitest";

import { type EvalCaseInput, EvalCaseSchema, grade, type Transcript } from "../src/index.js";

const evalCase = (overrides: Partial<EvalCaseInput> = {}) =>
  EvalCaseSchema.parse({
    id: "case",
    description: "A case",
    patientMrn: "FAKE-001",
    userMessage: "Question?",
    ...overrides,
  });

const transcript = (overrides: Partial<Transcript> = {}): Transcript => ({
  answer: "Hemoglobin is 12.9 g/dL, which is low.",
  toolCalls: [{ name: "get_lab_results", input: { test_name: "Hemoglobin" }, isError: false }],
  stopReason: "stop",
  ...overrides,
});

const failures = (c: ReturnType<typeof evalCase>, t: Transcript) => grade(c, t).failures;

describe("grade", () => {
  it("passes a transcript that meets every check", () => {
    const result = grade(
      evalCase({
        expectedToolCalls: [{ name: "get_lab_results", args: { test_name: "hemoglobin" } }],
        forbiddenToolCalls: ["log_symptom"],
        answerIncludes: ["12.9", ["low", "decreased"]],
        answerExcludes: ["mmol/L"],
        maxToolCalls: 1,
      }),
      transcript(),
    );

    expect(result).toEqual({
      caseId: "case",
      passed: true,
      toolCalls: ["get_lab_results"],
      failures: [],
    });
  });

  it("requires the expected tool, with matching arguments and without an error", () => {
    const c = evalCase({
      expectedToolCalls: [{ name: "get_vitals_trend", args: { vital_type: "pain_score" } }],
    });
    const expected = 'Expected a successful call to get_vitals_trend({"vital_type":"pain_score"}).';

    expect(failures(c, transcript())).toEqual([expected]);
    expect(
      failures(
        c,
        transcript({
          toolCalls: [
            { name: "get_vitals_trend", input: { vital_type: "weight" }, isError: false },
          ],
        }),
      ),
    ).toEqual([expected]);
    expect(
      failures(
        c,
        transcript({
          toolCalls: [
            { name: "get_vitals_trend", input: { vital_type: "pain_score" }, isError: true },
          ],
        }),
      ),
    ).toEqual([expected]);
  });

  it("accepts a retry that succeeds after a tool error", () => {
    const c = evalCase({ expectedToolCalls: [{ name: "get_lab_results" }] });
    const t = transcript({
      toolCalls: [
        { name: "get_lab_results", input: { since: "bad" }, isError: true },
        { name: "get_lab_results", input: {}, isError: false },
      ],
    });

    expect(failures(c, t)).toEqual([]);
  });

  it("flags forbidden tools and too many tool calls", () => {
    const c = evalCase({ forbiddenToolCalls: ["get_lab_results"], maxToolCalls: 0 });

    expect(failures(c, transcript())).toEqual([
      "get_lab_results must not be called.",
      "Made 1 tool calls; at most 0 expected.",
    ]);
  });

  it("checks what the answer mentions, ignoring case and spacing", () => {
    const c = evalCase({
      answerIncludes: ["HEMOGLOBIN  is", ["platelets", "lymphocytes"]],
      answerExcludes: ["g/dl"],
    });

    expect(failures(c, transcript())).toEqual([
      'The answer should mention "platelets" or "lymphocytes".',
      'The answer must not mention "g/dl".',
    ]);
  });

  it("fails on a stream error, an early stop or an empty answer", () => {
    const c = evalCase();

    expect(
      failures(c, transcript({ answer: "", error: "The assistant could not answer." })),
    ).toEqual(["Error: The assistant could not answer."]);
    expect(failures(c, transcript({ stopReason: "max_tool_rounds" }))).toEqual([
      "Stopped early: max_tool_rounds",
    ]);
    expect(failures(c, transcript({ answer: "  " }))).toEqual(["The answer is empty."]);
  });
});
