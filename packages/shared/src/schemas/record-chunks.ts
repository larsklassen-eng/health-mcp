import { z } from "zod";

/**
 * Where a searchable chunk of patient text comes from (RAG option A):
 * an imaging report, the patient's clinician notes, a symptom note or a chat message.
 */
export const ChunkSourceTypeSchema = z.enum([
  "imaging_report",
  "patient_notes",
  "symptom",
  "chat_message",
]);

export type ChunkSourceType = z.infer<typeof ChunkSourceTypeSchema>;
