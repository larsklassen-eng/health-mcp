import { z } from "zod";

/**
 * A change to a patient's record by a tool that changes data: one field's old
 * and new value. A new entry (a symptom, a medication) has no old values.
 */
export const RecordChangeSchema = z.object({
  field: z.string(),
  /** Absent when the field was empty, for a new entry, or for an added note. */
  before: z.string().optional(),
  after: z.string(),
});

/**
 * What a tool that changes data returns on a dry run (nothing saved), and what
 * `update_patient_profile` and `update_medication` return when they save.
 */
export const RecordChangesOutputSchema = z.object({
  changes: z.array(RecordChangeSchema),
});

export type RecordChange = z.infer<typeof RecordChangeSchema>;
export type RecordChangesOutput = z.infer<typeof RecordChangesOutputSchema>;
