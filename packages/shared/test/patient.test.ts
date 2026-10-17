import { describe, expect, it } from "vitest";

import {
  CreatePatientInputSchema,
  PatientSummarySchema,
  UpdatePatientInputSchema,
} from "../src/index.js";
import { validPatient } from "./fixtures.js";

describe("CreatePatientInputSchema", () => {
  it("accepts a minimal patient and defaults status to active", () => {
    expect(CreatePatientInputSchema.parse(validPatient).status).toBe("active");
  });

  it.each([
    ["an empty mrn", { mrn: "" }],
    ["an unknown sex", { sex: "robot" }],
    ["a malformed date of birth", { dateOfBirth: "01/01/1980" }],
    ["a timestamp as surgery date", { surgeryDate: "2026-09-01T10:00:00Z" }],
  ])("rejects %s", (_label, override) => {
    expect(CreatePatientInputSchema.safeParse({ ...validPatient, ...override }).success).toBe(
      false,
    );
  });

  it("does not accept server-owned fields from the client", () => {
    const parsed = CreatePatientInputSchema.parse({
      ...validPatient,
      id: "injected",
      createdAt: "x",
    });
    expect(parsed).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("createdAt");
  });
});

describe("UpdatePatientInputSchema", () => {
  it("allows partial updates", () => {
    expect(UpdatePatientInputSchema.parse({ notes: "Walking unaided" })).toEqual({
      notes: "Walking unaided",
    });
  });

  it("does not reset status when it is omitted", () => {
    expect(UpdatePatientInputSchema.parse({ notes: "x" })).not.toHaveProperty("status");
  });

  it("still validates the fields it receives", () => {
    expect(UpdatePatientInputSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("PatientSummarySchema", () => {
  it("only keeps list fields", () => {
    expect(Object.keys(PatientSummarySchema.shape).sort()).toEqual(
      ["diagnosis", "firstName", "id", "lastName", "mrn", "status"].sort(),
    );
  });
});
