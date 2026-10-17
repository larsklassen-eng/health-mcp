import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PatientImportFileSchema } from "@health-mcp/shared";
import { describe, expect, it } from "vitest";

import { CASES, EvalCaseSchema } from "../src/index.js";

const fixture = PatientImportFileSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../fixtures/synthetic-patients.json", import.meta.url)),
      "utf8",
    ),
  ),
);
const cases = CASES.map((input) => EvalCaseSchema.parse(input));
/** All of a fixture patient's data as lowercase text, to check that expected values exist. */
const patientText = (mrn: string) =>
  JSON.stringify(fixture.patients.find((bundle) => bundle.patient.mrn === mrn)).toLowerCase();

describe("eval cases", () => {
  it("are valid and have unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it.each(cases)("$id uses a patient from the synthetic fixture", ({ patientMrn }) => {
    expect(fixture.patients.map((bundle) => bundle.patient.mrn)).toContain(patientMrn);
  });

  // Single expected strings are facts from the data; lists of alternatives are wording.
  it.each(cases)("$id only expects values the patient's data contains", (c) => {
    const text = patientText(c.patientMrn);
    for (const expected of c.answerIncludes)
      if (typeof expected === "string") expect(text).toContain(expected.toLowerCase());
  });

  it.each(cases)("$id only excludes values the patient's data does not contain", (c) => {
    const text = patientText(c.patientMrn);
    for (const excluded of c.answerExcludes) expect(text).not.toContain(excluded.toLowerCase());
  });
});
