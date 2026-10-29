import { describe, expect, it } from "vitest";

import {
  gradeRetrieval,
  type RetrievalCase,
  RetrievalCaseSchema,
  summarizeRetrieval,
} from "../src/index.js";

const sleepCase = RetrievalCaseSchema.parse({
  id: "sleep",
  patientMrn: "FAKE-GBM-0001",
  query: "trouble sleeping",
  expected: { source: "symptom", textIncludes: "falling asleep" },
});
const offTopic = RetrievalCaseSchema.parse({
  id: "weather",
  patientMrn: "FAKE-GBM-0001",
  query: "what is the weather like",
});

const passage = (sourceType: string, body: string, similarity?: number) => ({
  sourceType,
  text: `Title (2026-08-14)\n${body}`,
  ...(similarity !== undefined && { similarity }),
});

describe("gradeRetrieval", () => {
  it("passes with the rank of the expected passage, ignoring case and spacing", () => {
    const result = gradeRetrieval(sleepCase, [
      passage("symptom", "Fatigue", 0.7),
      passage("symptom", "Insomnia: trouble  FALLING asleep.", 0.68),
    ]);

    expect(result).toMatchObject({ caseId: "sleep", passed: true, rank: 2, failures: [] });
    expect(result.retrieved).toEqual([
      "symptom (0.70): Fatigue",
      "symptom (0.68): Insomnia: trouble  FALLING asleep.",
    ]);
  });

  it("fails when the passage is missing, from another source, or below the top k", () => {
    const wrongSource = [passage("chat_message", "Trouble falling asleep?", 0.9)];
    const tooLow = [
      ...Array.from({ length: 5 }, () => passage("symptom", "Fatigue", 0.6)),
      passage("symptom", "Trouble falling asleep."),
    ];

    for (const results of [[], wrongSource, tooLow]) {
      const result = gradeRetrieval(sleepCase, results);
      expect(result.passed).toBe(false);
      expect(result.rank).toBeUndefined();
      expect(result.failures).toEqual([
        'Expected a symptom passage with "falling asleep" in the top 5.',
      ]);
    }
  });

  it("expects nothing when no passage is relevant, and labels keyword matches", () => {
    expect(gradeRetrieval(offTopic, []).passed).toBe(true);

    const result = gradeRetrieval(offTopic, [passage("symptom", "x".repeat(100))]);
    expect(result.failures).toEqual(["Expected no passages, got 1."]);
    expect(result.retrieved).toEqual([`symptom (keyword): ${"x".repeat(80)}…`]);
  });
});

describe("summarizeRetrieval", () => {
  it("reports the hit rate and mean reciprocal rank over cases with an expected passage", () => {
    const second: RetrievalCase = { ...sleepCase, id: "second" };
    const missed: RetrievalCase = { ...sleepCase, id: "missed" };
    const results = [
      { caseId: "sleep", passed: true, rank: 1, failures: [], retrieved: [] },
      { caseId: "second", passed: true, rank: 2, failures: [], retrieved: [] },
      { caseId: "missed", passed: false, failures: ["…"], retrieved: [] },
      { caseId: "weather", passed: true, failures: [], retrieved: [] },
    ];

    expect(summarizeRetrieval([sleepCase, second, missed, offTopic], results)).toEqual({
      passed: 3,
      total: 4,
      hitRate: 2 / 3,
      meanReciprocalRank: (1 + 0.5 + 0) / 3,
    });
  });
});
