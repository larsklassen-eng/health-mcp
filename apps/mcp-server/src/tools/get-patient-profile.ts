import { type HealthDb, patients, toPatient } from "@health-mcp/db";
import type { Patient } from "@health-mcp/shared";
import { eq } from "drizzle-orm";

import { type ToolHandler, ToolError } from "./tool.js";

export const getPatientProfile =
  (db: HealthDb): ToolHandler<"get_patient_profile"> =>
  ({ patient_id }): Patient => {
    const row = db.select().from(patients).where(eq(patients.id, patient_id)).get();
    if (!row) throw new ToolError(`Patient ${patient_id} not found.`);
    return toPatient(row);
  };
