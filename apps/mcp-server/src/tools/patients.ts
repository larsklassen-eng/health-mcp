import { type HealthDb, type PatientRow, patients } from "@health-mcp/db";
import { eq } from "drizzle-orm";

import { ToolError } from "./tool.js";

/** The patient row, or a tool error the model can read. */
export function requirePatient(db: HealthDb, patientId: string): PatientRow {
  const row = db.select().from(patients).where(eq(patients.id, patientId)).get();
  if (!row) throw new ToolError(`Patient ${patientId} not found.`);
  return row;
}
