import { describe, expect, it } from "vitest";

import {
  CASES,
  datasetUpload,
  EvalCaseSchema,
  evaluationsFor,
  experimentFor,
  type PhoenixReport,
  PhoenixReportSchema,
  reportTime,
  runFor,
} from "../src/index.js";

const result = (extra: Partial<PhoenixReport["results"][number]> = {}) =>
  PhoenixReportSchema.parse({
    results: [{ caseId: "a", passed: true, toolCalls: [], failures: [], ...extra }],
  }).results[0]!;

const start = new Date("2026-11-12T11:06:40.824Z");

describe("datasetUpload", () => {
  it("has one example per case, keyed by the case id", () => {
    const cases = CASES.map((c) => EvalCaseSchema.parse(c));
    const upload = datasetUpload(cases);
    expect(upload.example_ids).toEqual(cases.map((c) => c.id));
    expect(upload.inputs).toHaveLength(cases.length);
    expect(upload.outputs).toHaveLength(cases.length);
    expect(upload.metadata).toHaveLength(cases.length);
    expect(upload.inputs[0]).toMatchObject({
      caseId: cases[0]!.id,
      userMessage: cases[0]!.userMessage,
    });
  });
});

describe("experimentFor", () => {
  it("names the run by model and time, and records the report and what produced it", () => {
    const report = PhoenixReportSchema.parse({
      model: "anthropic/claude-haiku-5.5",
      provenance: { gitCommit: "b466c6754b31", gitDirty: true },
      usage: { costUsd: 0.03 },
      results: [result({ attempt: 1 }), result({ attempt: 3 })],
    });
    const experiment = experimentFor(report, "/x/eval-results/r.json", start);
    expect(experiment.name).toBe("claude-haiku-5.5 · 2026-11-12 11:06");
    expect(experiment.repetitions).toBe(3);
    expect(experiment.metadata).toMatchObject({
      report: "r.json",
      gitCommit: "b466c67",
      uncommittedChanges: true,
      costUsd: 0.03,
    });
  });
});

describe("evaluationsFor", () => {
  it("grades pass/fail, the judge's share, ungrounded numbers and cost", () => {
    const evaluations = evaluationsFor(
      result({
        passed: false,
        failures: ["Judge: not met"],
        judgeVerdicts: [
          { criterion: "One.", met: true, reason: "ok" },
          { criterion: "Two.", met: false, reason: "no" },
        ],
        ungroundedNumbers: [{ value: "4000", context: "…4000 mg/day…" }],
        usage: { modelCalls: 2, inputTokens: 1, outputTokens: 1, costUsd: 0.002 },
      }),
    );
    expect(evaluations.map((e) => [e.name, e.result.score])).toEqual([
      ["passed", 0],
      ["judge", 0.5],
      ["ungrounded numbers", 1],
      ["cost (USD)", 0.002],
    ]);
    expect(evaluations[1]!.result.explanation).toBe("Not met: Two. no");
    expect(evaluations[2]!.result.explanation).toBe("4000: …4000 mg/day…");
  });

  it("leaves out the judge without a rubric, and cost when not recorded", () => {
    expect(evaluationsFor(result()).map((e) => e.name)).toEqual(["passed", "ungrounded numbers"]);
  });
});

describe("runFor", () => {
  it("ends the run after the answer's duration, with its tool calls but not their results", () => {
    const run = runFor(
      result({
        attempt: 2,
        durationMs: 5000,
        answer: "Hi",
        toolInputs: [{ name: "get_lab_results", input: { limit: 5 }, output: { results: [] } }],
      }),
      "node-1",
      start,
    );
    expect(run).toEqual({
      dataset_example_id: "node-1",
      repetition_number: 2,
      start_time: "2026-11-12T11:06:40.824Z",
      end_time: "2026-11-12T11:06:45.824Z",
      output: {
        answer: "Hi",
        toolCalls: [{ name: "get_lab_results", input: { limit: 5 } }],
        failures: [],
      },
    });
  });
});

describe("reportTime", () => {
  it("reads the run's start from the report's name", () => {
    expect(reportTime("eval-results/2026-11-12T11-06-40.824Z.json")).toEqual(start);
    expect(reportTime("eval-results/retrieval-2026-11-11T19-34-21.041Z.json")?.toISOString()).toBe(
      "2026-11-11T19:34:21.041Z",
    );
    expect(reportTime("notes.json")).toBeUndefined();
  });
});
