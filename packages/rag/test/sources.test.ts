import { readFileSync } from "node:fs";

import { PatientImportFileSchema } from "@health-mcp/shared";
import { describe, expect, it } from "vitest";

import {
  chatMessageSource,
  chunkSource,
  DEFAULT_CHUNK_OPTIONS,
  imagingStudySource,
  patientNotesSource,
  symptomSource,
} from "../src/index.js";

const study = {
  id: "s1",
  modality: "MR",
  bodyPart: "Brain",
  description: "MRI brain with contrast",
  studyDate: "2026-08-18",
  impression: "No residual tumor.",
  report: "Findings: resection cavity without enhancement.",
};

describe("source texts", () => {
  it("uses the study's impression and report, titled with its description and date", () => {
    expect(imagingStudySource(study)).toEqual({
      sourceType: "imaging_report",
      sourceId: "s1",
      sourceDate: "2026-08-18",
      title: "Imaging report: MRI brain with contrast (2026-08-18)",
      text: "Impression: No residual tumor.\n\nFindings: resection cavity without enhancement.",
    });
  });

  it("names a study by modality and body part without a description; skips empty ones", () => {
    const { description: _, ...rest } = study;
    expect(imagingStudySource(rest)?.title).toBe("Imaging report: MR Brain (2026-08-18)");
    const { impression: _i, report: _r, ...empty } = study;
    expect(imagingStudySource(empty)).toBeUndefined();
  });

  it("indexes the clinician's notes, dated by the patient's last update", () => {
    const patient = { id: "p1", notes: "Walking unaided.", updatedAt: "2026-10-02T09:00:00.000Z" };

    expect(patientNotesSource(patient)).toMatchObject({
      sourceType: "patient_notes",
      sourceId: "p1",
      sourceDate: "2026-10-02",
      title: "Clinician notes (updated 2026-10-02)",
    });
    expect(patientNotesSource({ ...patient, notes: "  " })).toBeUndefined();
  });

  it("describes a symptom with its severity, so it is found even without notes", () => {
    const symptom = {
      id: "y1",
      name: "Dizziness",
      severity: 3,
      recordedAt: "2026-10-05T07:00:00Z",
    };

    expect(symptomSource(symptom).text).toBe("Dizziness, severity 3/10.");
    expect(symptomSource({ ...symptom, notes: "When standing up." }).text).toBe(
      "Dizziness, severity 3/10. When standing up.",
    );
  });

  it("indexes only what the clinician wrote in the chat", () => {
    const message = {
      id: "m1",
      content: "She felt dizzy on Monday.",
      createdAt: "2026-10-06T10:00:00Z",
    };

    expect(chatMessageSource({ ...message, role: "user" })).toMatchObject({
      sourceType: "chat_message",
      title: "Clinician's chat message (2026-10-06)",
    });
    expect(chatMessageSource({ ...message, role: "assistant" })).toBeUndefined();
  });
});

describe("chunkSource", () => {
  it("numbers the chunks and starts each with the source's title", () => {
    const source = imagingStudySource({ ...study, report: "Findings. ".repeat(200) })!;

    const chunks = chunkSource(source);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.text.startsWith(`${source.title}\n`))).toBe(true);
    expect(chunks[0]).toMatchObject({ sourceType: "imaging_report", sourceId: "s1" });
  });

  it("keeps the synthetic patients' reports and notes to a few small chunks each", () => {
    const fixture = PatientImportFileSchema.parse(
      JSON.parse(
        readFileSync(new URL("../../../fixtures/synthetic-patients.json", import.meta.url), "utf8"),
      ),
    );
    const sources = fixture.patients.flatMap(({ patient, imagingStudies }) => [
      patientNotesSource({ id: patient.mrn, updatedAt: "2026-10-01T00:00:00Z", ...patient }),
      ...imagingStudies.map((s, i) => imagingStudySource({ id: `${patient.mrn}-${i}`, ...s })),
    ]);

    const chunks = sources.flatMap((source) => (source ? chunkSource(source) : []));

    expect(sources.filter(Boolean)).toHaveLength(30); // 8 notes + 22 reports
    expect(chunks.length).toBeLessThan(45);
    for (const chunk of chunks)
      expect(chunk.text.split("\n").slice(1).join("\n").length).toBeLessThanOrEqual(
        DEFAULT_CHUNK_OPTIONS.maxChars,
      );
  });
});
