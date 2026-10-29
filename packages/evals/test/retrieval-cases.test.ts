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

describe("retrieval cases", () => {
  it("are valid, have unique ids and include cases where nothing is relevant", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.some((c) => !c.expected)).toBe(true);
  });

  it.each(cases.filter((c) => c.expected))(
    "$id expects a phrase that is in one of the patient's texts of that kind",
    ({ patientMrn, expected }) => {
      const texts = sourceTexts(patientMrn, expected!.source).map((t) => t.toLowerCase());
      expect(texts.some((t) => t.includes(expected!.textIncludes.toLowerCase()))).toBe(true);
    },
  );
});
