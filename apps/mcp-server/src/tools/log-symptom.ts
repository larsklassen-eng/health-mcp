import { type HealthDb, symptoms, toSymptomInput } from "@health-mcp/db";
import type { SymptomInput } from "@health-mcp/shared";

import { change, type ChangesOutput } from "./changes.js";
import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export interface LogSymptomOutput {
  /** The symptom as saved. */
  symptom: SymptomInput;
}

/**
 * Saves a symptom, recorded now. With `dry_run`, returns the entry as changes
 * without saving (apps/api's preview); otherwise this server saves whenever
 * it is called, and apps/api only calls it after the clinician has confirmed it.
 */
export const logSymptom =
  (db: HealthDb, now: () => Date = () => new Date()): ToolHandler<"log_symptom"> =>
  ({ patient_id, dry_run, name, severity, notes }): LogSymptomOutput | ChangesOutput => {
    requirePatient(db, patient_id);
    if (dry_run)
      return {
        changes: [
          change("symptom", undefined, name.trim()),
          change("severity", undefined, `${severity}/10`),
          ...(notes?.trim() ? [change("notes", undefined, notes.trim())] : []),
        ],
      };
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
