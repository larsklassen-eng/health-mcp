import { describe, expect, it } from "vitest";

import {
  type AgentReport,
  agentOutcomes,
  compareAgentReports,
  compareRetrievalReports,
  type RetrievalReport,
} from "../src/index.js";

const attempts = (caseId: string, ...passed: boolean[]) =>
  passed.map((p) => ({ caseId, passed: p, failures: p ? [] : [`${caseId} failed.`] }));

const agentReport = (results: AgentReport["results"], extra: Partial<AgentReport> = {}) => ({
  model: "m1",
  results,
  ...extra,
});

describe("agentOutcomes", () => {
  it("counts passes over attempts, with each failure once", () => {
    const outcomes = agentOutcomes(agentReport([...attempts("a", true, false, false)]));
    expect(outcomes.get("a")).toEqual({ passes: 1, attempts: 3, failures: ["a failed."] });
  });
});

describe("compareAgentReports", () => {
  it("names what broke, got worse, was fixed, got better, was added or removed", () => {
    const before = agentReport([
      ...attempts("broke", true, true),
      ...attempts("worse", true, false, false),
      ...attempts("fixed", false),
      ...attempts("better", false, false, true),
      ...attempts("same", true),
      ...attempts("removed", true),
    ]);
    const after = agentReport([
      ...attempts("broke", true, false),
      ...attempts("worse", false, false, false),
      ...attempts("fixed", true),
      ...attempts("better", true, false, true),
      ...attempts("same", true),
      ...attempts("added", true),
    ]);

    const result = compareAgentReports(before, after);

    expect(result.changes.map((c) => [c.kind, c.caseId])).toEqual([
      ["broke", "broke"],
      ["worse", "worse"],
      ["fixed", "fixed"],
      ["better", "better"],
      ["added", "added"],
      ["removed", "removed"],
    ]);
    expect(result.unchanged).toBe(1);
    expect(result.before).toMatchObject({ cases: 6, passAll: 3 });
    expect(result.after).toMatchObject({ cases: 6, passAll: 3 });
  });

  it("lists the settings that differ, and whether both reports recorded the code", () => {
    const before = agentReport(attempts("a", true), {
      provenance: { gitCommit: "aaaaaaa1111", toolsHash: "t1", systemPromptHash: "p1" },
    });
    const after = agentReport(attempts("a", true), {
      model: "m2",
      judgeModel: "j",
      provenance: { gitCommit: "bbbbbbb2222", toolsHash: "t1", systemPromptHash: "p2" },
    });

    const result = compareAgentReports(before, after);

    expect(result.provenanceRecorded).toBe(true);
    expect(result.settings).toEqual([
      { name: "model", before: "m1", after: "m2" },
      { name: "judge model", before: "(not recorded)", after: "j" },
      { name: "git commit", before: "aaaaaaa", after: "bbbbbbb" },
      { name: "system prompt", before: "p1", after: "p2" },
    ]);
    expect(compareAgentReports(agentReport([]), after).provenanceRecorded).toBe(false);
  });
});

describe("compareRetrievalReports", () => {
  const check = (caseId: string, passed: boolean, rank?: number, recall?: number) => ({
    caseId,
    passed,
    failures: passed ? [] : ["Expected…"],
    ...(rank !== undefined && { rank }),
    ...(recall !== undefined && { recall }),
  });

  it("describes changes in passing, rank and recall, the worse ones first", () => {
    const before: RetrievalReport = {
      minSimilarity: 0.57,
      results: [check("better", true, 3, 0.5), check("lost", true, 1), check("same", true, 1)],
    };
    const after: RetrievalReport = {
      minSimilarity: 0.58,
      results: [check("better", true, 1, 1), check("lost", false), check("same", true, 1)],
    };

    const result = compareRetrievalReports(before, after);

    expect(result.settings).toContainEqual({
      name: "similarity cutoff",
      before: "0.57",
      after: "0.58",
    });
    expect(result.changes.map((c) => [c.caseId, c.worse, c.what])).toEqual([
      ["lost", true, ["now fails", "rank 1 → not found"]],
      ["better", false, ["rank 3 → 1", "recall 50% → 100%"]],
    ]);
    expect(result.unchanged).toBe(1);
  });

  it("ignores recall when the older report has none", () => {
    const result = compareRetrievalReports(
      { results: [check("a", true, 1)] },
      { results: [check("a", true, 1, 1)] },
    );
    expect(result.changes).toEqual([]);
  });
});
