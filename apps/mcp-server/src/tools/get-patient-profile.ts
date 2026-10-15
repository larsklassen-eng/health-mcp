import { type HealthDb, toPatient } from "@health-mcp/db";
import type { Patient } from "@health-mcp/shared";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export const getPatientProfile =
  (db: HealthDb): ToolHandler<"get_patient_profile"> =>
  ({ patient_id }): Patient =>
    toPatient(requirePatient(db, patient_id));
