import type { Patient } from "@health-mcp/shared";
import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/chat/system-prompt.js";

const patient: Patient = {
  id: "p1",
  mrn: "FAKE-001",
  firstName: "Ana",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  sex: "female",
  status: "active",
  diagnosis: "Synthetic meningioma",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

describe("buildSystemPrompt", () => {
  it("includes the patient profile and today's date", () => {
    const prompt = buildSystemPrompt(patient, "2026-10-13");

    expect(prompt).toContain("Name: Ana Test");
    expect(prompt).toContain("MRN: FAKE-001");
    expect(prompt).toContain("Diagnosis: Synthetic meningioma");
    expect(prompt).toContain("Today's date is 2026-10-13.");
  });

  it("only lists optional fields that are present", () => {
    expect(buildSystemPrompt(patient, "2026-10-13")).not.toMatch(/Surgery date|Clinician notes/);

    const withOptional = buildSystemPrompt(
      { ...patient, surgeryDate: "2026-09-01", notes: "Walks with a cane" },
      "2026-10-13",
    );
    expect(withOptional).toContain("Surgery date: 2026-09-01");
    expect(withOptional).toContain("Clinician notes: Walks with a cane");
  });

  it("tells the model that tools always act on this patient", () => {
    const prompt = buildSystemPrompt(patient, "2026-10-13");

    expect(prompt).toContain("they always act on this patient, so you never choose which patient");
    expect(prompt).not.toContain("cannot yet look up");
  });

  it("is identical for the same patient and day, so providers can cache it", () => {
    expect(buildSystemPrompt(patient, "2026-10-13")).toBe(
      buildSystemPrompt({ ...patient }, "2026-10-13"),
    );
  });

  it("does not include volatile or internal fields", () => {
    const prompt = buildSystemPrompt(patient, "2026-10-13");

    expect(prompt).not.toContain(patient.id);
    expect(prompt).not.toContain(patient.updatedAt);
  });

  it("lists the patient's lab test names when there are any", () => {
    const prompt = buildSystemPrompt(patient, "2026-10-13", ["ALT", "Hemoglobin"]);

    expect(prompt).toContain("Lab tests on record (use these exact names");
    expect(prompt).toContain(": ALT, Hemoglobin.");
    expect(buildSystemPrompt(patient, "2026-10-13")).not.toContain("Lab tests on record");
  });
});
