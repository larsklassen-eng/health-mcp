import { describe, expect, it } from "vitest";

import { PatientImportFileSchema } from "../src/index.js";
import { validPatient } from "./fixtures.js";

const lab = {
  testName: "Hemoglobin",
  value: 11.2,
  unit: "g/dL",
  referenceLow: 12,
  referenceHigh: 16,
  flag: "low",
  collectedAt: "2026-09-10T08:00:00-05:00",
};

describe("PatientImportFileSchema", () => {
  it("accepts a file and fills in defaults", () => {
    const file = PatientImportFileSchema.parse({
      version: 1,
      patients: [{ patient: validPatient, labResults: [lab] }],
    });
    const [bundle] = file.patients;

    expect(bundle?.patient.status).toBe("active");
    expect(bundle?.labResults).toHaveLength(1);
    expect(bundle?.vitals).toEqual([]);
    expect(bundle?.medications).toEqual([]);
    expect(bundle?.symptoms).toEqual([]);
    expect(bundle?.milestones).toEqual([]);
  });

  it("accepts timestamps with a UTC offset", () => {
    const file = { version: 1, patients: [{ patient: validPatient, labResults: [lab] }] };
    expect(PatientImportFileSchema.safeParse(file).success).toBe(true);
  });

  it.each([
    ["an unsupported version", { version: 2, patients: [{ patient: validPatient }] }],
    ["a file without patients", { version: 1, patients: [] }],
    [
      "an invalid lab flag",
      {
        version: 1,
        patients: [{ patient: validPatient, labResults: [{ ...lab, flag: "weird" }] }],
      },
    ],
    [
      "a symptom severity above 10",
      {
        version: 1,
        patients: [
          {
            patient: validPatient,
            symptoms: [{ name: "headache", severity: 11, recordedAt: "2026-09-10T08:00:00Z" }],
          },
        ],
      },
    ],
    [
      "an unknown vital type",
      {
        version: 1,
        patients: [
          {
            patient: validPatient,
            vitals: [{ type: "mood", value: 5, unit: "", recordedAt: "2026-09-10T08:00:00Z" }],
          },
        ],
      },
    ],
  ])("rejects %s", (_label, file) => {
    expect(PatientImportFileSchema.safeParse(file).success).toBe(false);
  });

  it("points to the failing field", () => {
    const result = PatientImportFileSchema.safeParse({
      version: 1,
      patients: [{ patient: { ...validPatient, mrn: "" } }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["patients", 0, "patient", "mrn"]);
  });
});
