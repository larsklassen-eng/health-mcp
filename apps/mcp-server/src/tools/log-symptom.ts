import { type HealthDb, symptoms, toSymptomInput } from "@health-mcp/db";
import type { SymptomInput } from "@health-mcp/shared";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export interface LogSymptomOutput {
  /** The symptom as saved. */
  symptom: SymptomInput;
}

/**
 * Saves a symptom, recorded now. This server runs it whenever it is called;
 * apps/api only calls it after the clinician has confirmed it in the chat.
 */
export const logSymptom =
  (db: HealthDb, now: () => Date = () => new Date()): ToolHandler<"log_symptom"> =>
  ({ patient_id, name, severity, notes }): LogSymptomOutput => {
    requirePatient(db, patient_id);
    const row = db
      .insert(symptoms)
      .values({
        patientId: patient_id,
        name: name.trim(),
        severity,
        ...(notes?.trim() && { notes: notes.trim() }),
        recordedAt: now().toISOString(),
      })
      .returning()
      .get();
    return { symptom: toSymptomInput(row) };
  };
