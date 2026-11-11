import { describe, expect, it } from "vitest";

import {
  gradeRetrieval,
  type RetrievalCase,
  RetrievalCaseSchema,
  type RetrievedPassage,
  summarizeRetrieval,
} from "../src/index.js";

const sleepCase = RetrievalCaseSchema.parse({
  id: "sleep",
  patientMrn: "FAKE-GBM-0001",
  query: "trouble sleeping",
  relevant: [{ source: "symptom", textIncludes: "falling asleep" }],
  split: "tuning",
});
const sleepCourse = RetrievalCaseSchema.parse({
  id: "sleep-course",
  patientMrn: "FAKE-GBM-0001",
  query: "insomnia and whether it resolved",
  relevant: [
    { source: "symptom", textIncludes: "falling asleep" },
    { source: "symptom", textIncludes: "sleeping well" },
  ],
  split: "holdout",
});
const offTopic = RetrievalCaseSchema.parse({
  id: "weather",
  patientMrn: "FAKE-GBM-0001",
  query: "what is the weather like",
  offTopic: true,
  split: "tuning",
});
const isolation = RetrievalCaseSchema.parse({
  id: "walker",
  patientMrn: "FAKE-GBM-0001",
  query: "uses a walker outdoors",
  otherPatientText: ["Uses a walker outdoors"],
  split: "holdout",
});

const passage = (
  sourceType: string,
  body: string,
  similarity?: number,
  patientId = "p1",
): RetrievedPassage => ({
  sourceType,
  text: `Title (2026-08-14)\n${body}`,
  patientId,
  ...(similarity !== undefined && { similarity }),
});

describe("RetrievalCaseSchema", () => {
  it("needs something to check, and no relevant passages on an off-topic case", () => {
    const base = { id: "x", patientMrn: "FAKE-1", query: "anything", split: "holdout" };
    expect(RetrievalCaseSchema.safeParse(base).success).toBe(false);
    expect(
      RetrievalCaseSchema.safeParse({
        ...base,
        offTopic: true,
        relevant: [{ source: "symptom", textIncludes: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("gradeRetrieval", () => {
  it("passes with the rank of the expected passage, ignoring case and spacing", () => {
    const result = gradeRetrieval(
      sleepCase,
      [
        passage("symptom", "Fatigue", 0.7),
        passage("symptom", "Insomnia: trouble  FALLING asleep.", 0.68),
      ],
      "p1",
    );

    expect(result).toMatchObject({
      caseId: "sleep",
      passed: true,
      rank: 2,
      recall: 1,
      failures: [],
    });
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
      expect(result.recall).toBe(0);
      expect(result.failures).toEqual([
        'Expected a symptom passage with "falling asleep" in the top 5.',
      ]);
    }
  });

  it("with several relevant passages, passes on one and reports the share found", () => {
    const one = gradeRetrieval(sleepCourse, [
      passage("symptom", "Headache"),
      passage("symptom", "Sleeping well since the steroid taper ended."),
    ]);
    expect(one).toMatchObject({ passed: true, rank: 2, recall: 0.5 });

    const none = gradeRetrieval(sleepCourse, [passage("symptom", "Headache")]);
    expect(none.failures).toEqual(["Expected at least one of 2 relevant passages in the top 5."]);
  });

  it("expects nothing for an off-topic question, and labels keyword matches", () => {
    expect(gradeRetrieval(offTopic, []).passed).toBe(true);

    const result = gradeRetrieval(offTopic, [passage("symptom", "x".repeat(100))]);
    expect(result.failures).toEqual(["Expected no passages, got 1."]);
    expect(result.retrieved).toEqual([`symptom (keyword): ${"x".repeat(80)}…`]);
  });

  it("fails on another patient's passage, by owner or by text, in any case", () => {
    expect(gradeRetrieval(isolation, [passage("symptom", "Walking 20 minutes")], "p1").passed).toBe(
      true,
    );
    expect(
      gradeRetrieval(isolation, [passage("symptom", "Uses a walker outdoors.")], "p1").failures,
    ).toEqual(['Passage 1 has another patient\'s text: "Uses a walker outdoors".']);
    expect(
      gradeRetrieval(sleepCase, [passage("symptom", "Falling asleep", 0.8, "p2")], "p1").failures,
    ).toEqual(["Passage 1 belongs to another patient."]);
  });
});

describe("summarizeRetrieval", () => {
  it("reports hit rate, recall and MRR over relevant cases, and off-topic apart", () => {
    const missed: RetrievalCase = { ...sleepCase, id: "missed" };
    const results = [
      { caseId: "sleep", passed: true, rank: 1, recall: 1, failures: [], retrieved: [] },
      { caseId: "sleep-course", passed: true, rank: 2, recall: 0.5, failures: [], retrieved: [] },
      { caseId: "missed", passed: false, recall: 0, failures: ["…"], retrieved: [] },
      { caseId: "weather", passed: false, failures: ["…"], retrieved: [] },
      { caseId: "walker", passed: true, failures: [], retrieved: [] },
    ];

    expect(
      summarizeRetrieval([sleepCase, sleepCourse, missed, offTopic, isolation], results),
    ).toEqual({
      passed: 3,
      total: 5,
      hitRate: 2 / 3,
      recall: 0.5,
      meanReciprocalRank: (1 + 0.5 + 0) / 3,
      offTopicPassed: 0,
      offTopicTotal: 1,
    });
  });

  it("counts only the given cases, so a split can be summarized on its own", () => {
    const results = [
      { caseId: "sleep", passed: true, rank: 1, recall: 1, failures: [], retrieved: [] },
      { caseId: "sleep-course", passed: true, rank: 2, recall: 0.5, failures: [], retrieved: [] },
    ];
    expect(summarizeRetrieval([sleepCourse], results)).toMatchObject({
      total: 1,
      meanReciprocalRank: 0.5,
    });
  });
});
