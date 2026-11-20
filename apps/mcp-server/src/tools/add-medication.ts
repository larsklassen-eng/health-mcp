import { type HealthDb, medications, toMedicationInput } from "@health-mcp/db";
import type { MedicationInput } from "@health-mcp/shared";

import { isoDay } from "./changes.js";
import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export interface AddMedicationOutput {
  /** The medication as saved, with its id. */
  medication: MedicationInput & { id: string };
}

/**
 * Adds an active medication. This server runs it whenever it is called;
 * apps/api only calls it after the clinician has confirmed it.
 */
export const addMedication =
  (db: HealthDb, now: () => Date = () => new Date()): ToolHandler<"add_medication"> =>
  ({ patient_id, name, dosage, frequency, route, start_date }): AddMedicationOutput => {
    requirePatient(db, patient_id);
    const row = db
      .insert(medications)
      .values({
        patientId: patient_id,
        name,
        dosage,
        frequency,
        ...(route !== undefined && { route }),
        status: "active",
        startDate: start_date ?? isoDay(now()),
      })
      .returning()
      .get();
    return { medication: { id: row.id, ...toMedicationInput(row) } };
  };
