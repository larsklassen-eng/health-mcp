import { type HealthDb, medications, toMedicationInput } from "@health-mcp/db";
import type { MedicationInput } from "@health-mcp/shared";

import { change, type ChangesOutput, isoDay } from "./changes.js";
import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export interface AddMedicationOutput {
  /** The medication as saved, with its id. */
  medication: MedicationInput & { id: string };
}

/**
 * Adds an active medication. With `dry_run`, returns the entry as changes
 * without saving (apps/api's preview); otherwise this server saves whenever
 * it is called, and apps/api only calls it after the clinician has confirmed it.
 */
export const addMedication =
  (db: HealthDb, now: () => Date = () => new Date()): ToolHandler<"add_medication"> =>
  (input): AddMedicationOutput | ChangesOutput => {
    const { patient_id, name, dosage, frequency, route, start_date } = input;
    requirePatient(db, patient_id);
    const startDate = start_date ?? isoDay(now());
    if (input.dry_run)
      return {
        changes: [
          change("medication", undefined, name),
          change("dosage", undefined, dosage),
          change("frequency", undefined, frequency),
          ...(route !== undefined ? [change("route", undefined, route)] : []),
          change("start date", undefined, startDate),
        ],
      };
    const row = db
      .insert(medications)
      .values({
        patientId: patient_id,
        name,
        dosage,
        frequency,
        ...(route !== undefined && { route }),
        status: "active",
        startDate,
      })
      .returning()
      .get();
    return { medication: { id: row.id, ...toMedicationInput(row) } };
  };
