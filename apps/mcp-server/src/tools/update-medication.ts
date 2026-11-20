import { type HealthDb, medications } from "@health-mcp/db";
import { and, eq } from "drizzle-orm";

import { change, type ChangesOutput, type FieldChange, isoDay } from "./changes.js";
import { requirePatient } from "./patients.js";
import { ToolError, type ToolHandler } from "./tool.js";

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Changes one of the patient's medications, or stops it. The name the model
 * gives must be the medication's, so the clinician confirms what is changed.
 * This server runs it whenever it is called; apps/api only calls it after the
 * clinician has confirmed it.
 */
export const updateMedication =
  (db: HealthDb, now: () => Date = () => new Date()): ToolHandler<"update_medication"> =>
  (input): ChangesOutput => {
    const { patient_id, medication_id, medication_name, dosage, frequency, route, stop } = input;
    requirePatient(db, patient_id);
    const where = and(eq(medications.id, medication_id), eq(medications.patientId, patient_id));
    const medication = db.select().from(medications).where(where).get();
    if (!medication) throw new ToolError(`Medication ${medication_id} not found for this patient.`);
    if (!sameName(medication.name, medication_name))
      throw new ToolError(
        `Medication ${medication_id} is ${medication.name}, not ${medication_name}. ` +
          "Nothing was saved.",
      );

    const changes: FieldChange[] = [];
    const values: Partial<typeof medications.$inferInsert> = {};
    const fields = [
      ["dosage", dosage, medication.dosage],
      ["frequency", frequency, medication.frequency],
      ["route", route, medication.route],
    ] as const;
    for (const [field, next, current] of fields)
      if (next !== undefined && next !== current) {
        values[field] = next;
        changes.push(change(field, current, next));
      }
    if (stop) {
      if (medication.status === "stopped")
        throw new ToolError(`${medication.name} is already stopped. Nothing was saved.`);
      const endDate = input.end_date ?? isoDay(now());
      if (endDate < medication.startDate)
        throw new ToolError(
          `The end date ${endDate} is before ${medication.name} was started ` +
            `(${medication.startDate}). Nothing was saved.`,
        );
      values.status = "stopped";
      values.endDate = endDate;
      changes.push(change("status", medication.status, "stopped"));
      changes.push(change("end date", medication.endDate, endDate));
    }

    if (changes.length === 0)
      throw new ToolError(`Nothing to change: ${medication.name} already has these values.`);
    db.update(medications).set(values).where(where).run();
    return { changes: [change("medication", undefined, medication.name), ...changes] };
  };
