import { describe, expect, it } from "vitest";

import { CASES, EvalCaseSchema, JUDGE_LABELS } from "../src/index.js";

const cases = CASES.map((input) => EvalCaseSchema.parse(input));
const withRubric = cases.filter((c) => c.rubric.length > 0);

describe("judge labels", () => {
  it("have unique ids", () => {
    expect(new Set(JUDGE_LABELS.map((l) => l.id)).size).toBe(JUDGE_LABELS.length);
  });

  it.each(JUDGE_LABELS)("$id labels every statement of its case's rubric", (label) => {
    const evalCase = cases.find((c) => c.id === label.caseId);
    expect(evalCase?.rubric.length).toBeGreaterThan(0);
    expect(label.met).toHaveLength(evalCase!.rubric.length);
  });

  // A statement the judge has only seen met could be one it always says yes to.
  it.each(withRubric)("$id has a label that meets and one that misses each statement", (c) => {
    const labels = JUDGE_LABELS.filter((l) => l.caseId === c.id);
    for (const i of c.rubric.keys()) {
      expect(labels.some((l) => l.met[i] === true)).toBe(true);
      expect(labels.some((l) => l.met[i] === false)).toBe(true);
    }
  });
});
