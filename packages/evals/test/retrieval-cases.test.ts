import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PatientImportFileSchema } from "@health-mcp/shared";
import { describe, expect, it } from "vitest";

import { RETRIEVAL_CASES, RetrievalCaseSchema } from "../src/index.js";

const fixture = PatientImportFileSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../fixtures/synthetic-patients.json", import.meta.url)),
      "utf8",
    ),
  ),
);
const cases = RETRIEVAL_CASES.map((input) => RetrievalCaseSchema.parse(input));

/** A fixture patient's indexed texts of one kind, as the index sees them. */
function sourceTexts(mrn: string, source: string): string[] {
  const bundle = fixture.patients.find((b) => b.patient.mrn === mrn);
  if (!bundle) return [];
  switch (source) {
    case "patient_notes":
      return [bundle.patient.notes ?? ""];
    case "symptom":
      return bundle.symptoms.map((s) => `${s.name}: ${s.notes ?? ""}`);
    case "imaging_report":
      return bundle.imagingStudies.map((s) => `${s.report ?? ""} ${s.impression ?? ""}`);
    default:
      return [];
  }
}

/** All of a fixture patient's indexed text, lowercase. */
const allTexts = (mrn: string) =>
  ["patient_notes", "symptom", "imaging_report"].flatMap((source) =>
    sourceTexts(mrn, source).map((t) => t.toLowerCase()),
  );

describe("retrieval cases", () => {
  it("are valid, have unique ids and cover every kind of check in both splits", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const split of ["tuning", "holdout"] as const) {
      const inSplit = cases.filter((c) => c.split === split);
      expect(inSplit.filter((c) => c.relevant.length > 0).length).toBeGreaterThanOrEqual(10);
      expect(inSplit.some((c) => c.offTopic)).toBe(true);
    }
    expect(cases.some((c) => c.relevant.length > 1)).toBe(true);
    expect(cases.some((c) => c.otherPatientText.length > 0)).toBe(true);
  });

  it.each(cases.filter((c) => c.relevant.length > 0))(
    "$id expects phrases that are in the patient's texts of that kind",
    ({ patientMrn, relevant }) => {
      for (const { source, textIncludes } of relevant) {
        const texts = sourceTexts(patientMrn, source).map((t) => t.toLowerCase());
        expect(texts.some((t) => t.includes(textIncludes.toLowerCase()))).toBe(true);
      }
    },
  );

  it.each(cases.filter((c) => c.otherPatientText.length > 0))(
    "$id guards text that another patient has and this one does not",
    ({ patientMrn, otherPatientText }) => {
      const others = fixture.patients
        .filter((b) => b.patient.mrn !== patientMrn)
        .flatMap((b) => allTexts(b.patient.mrn));
      for (const text of otherPatientText.map((t) => t.toLowerCase())) {
        expect(allTexts(patientMrn).some((t) => t.includes(text))).toBe(false);
        expect(others.some((t) => t.includes(text))).toBe(true);
      }
    },
  );
});
