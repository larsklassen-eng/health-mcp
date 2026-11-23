import { describe, expect, it } from "vitest";

import { stalePreview } from "../src/chat/tool-call-decision.service.js";

const dosage = { field: "dosage", before: "4 mg", after: "2 mg" };
const note = { field: "notes (added)", after: "2026-11-20: Seizure-free." };

describe("stalePreview", () => {
  it("holds when the old values are the same, whatever the new ones", () => {
    expect(stalePreview([dosage, note], [dosage, { ...note, after: "2026-11-21: …" }])).toBe(
      undefined,
    );
  });

  it("names the first field whose old value changed", () => {
    expect(stalePreview([dosage], [{ ...dosage, before: "8 mg" }])).toBe(
      "dosage is now 8 mg, not 4 mg",
    );
    expect(stalePreview([{ ...dosage, before: undefined }], [dosage])).toBe(
      "dosage is now 4 mg, not empty",
    );
  });

  it("notices a field that no longer changes, or one that now would", () => {
    expect(stalePreview([dosage, note], [note])).toBe("dosage no longer changes");
    expect(stalePreview([note], [note, dosage])).toBe("dosage would now change too");
  });
});
