import type {
  ChatMessage,
  ChunkSourceType,
  ImagingStudy,
  Patient,
  Symptom,
} from "@health-mcp/shared";

import { type ChunkOptions, splitText } from "./chunker.js";

/** One record's searchable text, with what is needed to cite it. */
export interface TextSource {
  sourceType: ChunkSourceType;
  sourceId: string;
  /** `YYYY-MM-DD`. */
  sourceDate: string;
  /** First line of every chunk, e.g. "Imaging report: MRI brain (2026-08-18)". */
  title: string;
  text: string;
}

/** A chunk ready to be stored in `record_chunks` (without its patient). */
export interface Chunk {
  sourceType: ChunkSourceType;
  sourceId: string;
  sourceDate: string;
  chunkIndex: number;
  text: string;
}

const day = (timestamp: string) => timestamp.slice(0, 10);

/**
 * Splits a source into chunks. Each chunk starts with the source's title, so
 * it can be understood (and matched) on its own and cited by the model.
 */
export function chunkSource(source: TextSource, options?: ChunkOptions): Chunk[] {
  return splitText(source.text, options).map((piece, chunkIndex) => ({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceDate: source.sourceDate,
    chunkIndex,
    text: `${source.title}\n${piece}`,
  }));
}

/** The study's impression and report; `undefined` when it has neither. */
export function imagingStudySource(
  study: Pick<
    ImagingStudy,
    "id" | "modality" | "bodyPart" | "description" | "studyDate" | "impression" | "report"
  >,
): TextSource | undefined {
  const text = [study.impression && `Impression: ${study.impression}`, study.report]
    .filter(Boolean)
    .join("\n\n");
  if (!text) return undefined;
  const name = study.description ?? [study.modality, study.bodyPart].filter(Boolean).join(" ");
  return {
    sourceType: "imaging_report",
    sourceId: study.id,
    sourceDate: study.studyDate,
    title: `Imaging report: ${name} (${study.studyDate})`,
    text,
  };
}

/** The clinician's notes on the patient; `undefined` without notes. */
export function patientNotesSource(
  patient: Pick<Patient, "id" | "notes" | "updatedAt">,
): TextSource | undefined {
  if (!patient.notes?.trim()) return undefined;
  return {
    sourceType: "patient_notes",
    sourceId: patient.id,
    sourceDate: day(patient.updatedAt),
    title: `Clinician notes (updated ${day(patient.updatedAt)})`,
    text: patient.notes,
  };
}

/** A symptom with its severity and notes, so "dizziness" finds it even without notes. */
export function symptomSource(
  symptom: Pick<Symptom, "id" | "name" | "severity" | "notes" | "recordedAt">,
): TextSource {
  const date = day(symptom.recordedAt);
  return {
    sourceType: "symptom",
    sourceId: symptom.id,
    sourceDate: date,
    title: `Symptom (${date})`,
    text: [`${symptom.name}, severity ${symptom.severity}/10.`, symptom.notes]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * What the clinician wrote in the chat. The assistant's answers are not
 * indexed: they come from records that are indexed already, and searching
 * them would let the model find its own earlier claims as if they were facts.
 */
export function chatMessageSource(
  message: Pick<ChatMessage, "id" | "role" | "content" | "createdAt">,
): TextSource | undefined {
  if (message.role !== "user" || !message.content.trim()) return undefined;
  const date = day(message.createdAt);
  return {
    sourceType: "chat_message",
    sourceId: message.id,
    sourceDate: date,
    title: `Clinician's chat message (${date})`,
    text: message.content,
  };
}
