import { z } from "zod";

/**
 * Where a searchable chunk of patient text comes from (RAG):
 * an imaging report, the patient's clinician notes, a symptom note or a chat message.
 */
export const ChunkSourceTypeSchema = z.enum([
  "imaging_report",
  "patient_notes",
  "symptom",
  "chat_message",
]);

export type ChunkSourceType = z.infer<typeof ChunkSourceTypeSchema>;

/** A passage `search_patient_records` returns. */
export const RecordPassageSchema = z.object({
  source: ChunkSourceTypeSchema,
  /** The record it comes from: imaging study, symptom, chat message, or the patient (notes). */
  sourceId: z.string(),
  date: z.string(),
  /** E.g. "Imaging report: MRI brain (2026-08-18)". */
  title: z.string(),
  text: z.string(),
  /** Cosine similarity to the query (0–1), when found by meaning. */
  similarity: z.number().optional(),
  matchedBy: z.array(z.enum(["vector", "keyword"])),
});

export type RecordPassage = z.infer<typeof RecordPassageSchema>;

/** The output of `search_patient_records`. */
export const RecordSearchOutputSchema = z.object({
  /** Best first. */
  passages: z.array(RecordPassageSchema),
  /** Set when nothing relevant was found. */
  note: z.string().optional(),
});

export type RecordSearchOutput = z.infer<typeof RecordSearchOutputSchema>;
