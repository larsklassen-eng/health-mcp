import { type HealthDb, medications, toMedicationInput } from "@health-mcp/db";
import type { MedicationInput } from "@health-mcp/shared";
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export interface MedicationsOutput {
  /** Active before stopped, then the most recently started first. */
  medications: MedicationInput[];
}

export const getMedications =
  (db: HealthDb): ToolHandler<"get_medications"> =>
  ({ patient_id, status }): MedicationsOutput => {
    requirePatient(db, patient_id);

    const conditions: SQL[] = [eq(medications.patientId, patient_id)];
    if (status !== "all") conditions.push(eq(medications.status, status));

    const rows = db
      .select()
      .from(medications)
      .where(and(...conditions))
      .orderBy(
        desc(sql`${medications.status} = 'active'`),
        desc(medications.startDate),
        asc(medications.name),
      )
      .all();

    return { medications: rows.map(toMedicationInput) };
  };
