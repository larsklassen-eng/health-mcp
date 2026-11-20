import { type HealthDb, patients } from "@health-mcp/db";
import { PATIENT_NOTES_MAX } from "@health-mcp/shared";
import { eq } from "drizzle-orm";

import { change, type ChangesOutput, type FieldChange, isoDay } from "./changes.js";
import { requirePatient } from "./patients.js";
import { ToolError, type ToolHandler } from "./tool.js";

/**
 * Changes the patient's profile. A note is added to the end of the clinician
 * notes with today's date, never replacing them. This server runs it whenever
 * it is called; apps/api only calls it after the clinician has confirmed it.
 */
export const updatePatientProfile =
  (db: HealthDb, now: () => Date = () => new Date()): ToolHandler<"update_patient_profile"> =>
  ({ patient_id, diagnosis, surgery_date, status, add_note }): ChangesOutput => {
    const patient = requirePatient(db, patient_id);
    const changes: FieldChange[] = [];
    const values: Partial<typeof patients.$inferInsert> = {};

    if (diagnosis !== undefined && diagnosis !== patient.diagnosis) {
      values.diagnosis = diagnosis;
      changes.push(change("diagnosis", patient.diagnosis, diagnosis));
    }
    if (surgery_date !== undefined && surgery_date !== patient.surgeryDate) {
      values.surgeryDate = surgery_date;
      changes.push(change("surgery date", patient.surgeryDate, surgery_date));
    }
    if (status !== undefined && status !== patient.status) {
      values.status = status;
      changes.push(change("status", patient.status, status));
    }
    if (add_note !== undefined) {
      const line = `${isoDay(now())}: ${add_note}`;
      const notes = patient.notes?.trim() ? `${patient.notes.trimEnd()}\n\n${line}` : line;
      if (notes.length > PATIENT_NOTES_MAX)
        throw new ToolError(
          `The clinician notes would be longer than ${PATIENT_NOTES_MAX} characters. ` +
            "Nothing was saved; edit the notes on the patient page instead.",
        );
      values.notes = notes;
      changes.push(change("notes (added)", undefined, line));
    }

    if (changes.length === 0)
      throw new ToolError("Nothing to change: the profile already has these values.");
    db.update(patients).set(values).where(eq(patients.id, patient_id)).run();
    return { changes };
  };
