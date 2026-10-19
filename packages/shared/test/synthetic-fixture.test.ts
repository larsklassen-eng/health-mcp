import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PatientImportFileSchema } from "../src/index.js";

const file = JSON.parse(
  readFileSync(new URL("../../../fixtures/synthetic-patients.json", import.meta.url), "utf8"),
) as unknown;

describe("fixtures/synthetic-patients.json", () => {
  const { patients } = PatientImportFileSchema.parse(file);

  it("is a valid import file with at least 8 patients", () => {
    expect(patients.length).toBeGreaterThanOrEqual(8);
  });

  it("only contains clearly fake, unique record numbers", () => {
    const mrns = patients.map((bundle) => bundle.patient.mrn);
    expect(mrns.every((mrn) => mrn.startsWith("FAKE-"))).toBe(true);
    expect(new Set(mrns).size).toBe(mrns.length);
  });

  it("marks every patient as synthetic in the notes", () => {
    expect(
      patients.every((bundle) =>
        bundle.patient.notes?.startsWith("Synthetic patient for testing; not a real person."),
      ),
    ).toBe(true);
  });

  it("has no records dated before the patient was born", () => {
    for (const { patient, labResults, vitals, symptoms, imagingStudies } of patients) {
      const dates = [
        ...labResults.map((r) => r.collectedAt),
        ...vitals.map((v) => v.recordedAt),
        ...symptoms.map((s) => s.recordedAt),
        ...imagingStudies.map((s) => s.studyDate),
      ];
      expect(dates.every((date) => date.slice(0, 10) > patient.dateOfBirth)).toBe(true);
    }
  });

  it("gives every patient imaging studies with reports marked as synthetic", () => {
    for (const { imagingStudies } of patients) {
      expect(imagingStudies.length).toBeGreaterThanOrEqual(2);
      for (const study of imagingStudies)
        expect(study.report).toMatch(/^Synthetic report for testing; not a real patient\./);
    }
  });

  it("flags lab results consistently with their reference ranges", () => {
    for (const { labResults } of patients) {
      for (const { value, referenceLow, referenceHigh, flag } of labResults) {
        const expected =
          referenceLow !== undefined && value < referenceLow
            ? "low"
            : referenceHigh !== undefined && value > referenceHigh
              ? "high"
              : "normal";
        expect(flag).toBe(expected);
      }
    }
  });
});
