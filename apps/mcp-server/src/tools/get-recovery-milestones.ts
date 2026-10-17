import { type HealthDb, recoveryMilestones, toRecoveryMilestoneInput } from "@health-mcp/db";
import type { MilestoneStatus, RecoveryMilestoneInput } from "@health-mcp/shared";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export interface RecoveryMilestonesOutput {
  /** By target date, earliest first; milestones without one come last. */
  milestones: RecoveryMilestoneInput[];
  /** How many of the patient's milestones have each status, whatever the filter. */
  counts: Record<MilestoneStatus, number>;
}

export const getRecoveryMilestones =
  (db: HealthDb): ToolHandler<"get_recovery_milestones"> =>
  ({ patient_id, status }): RecoveryMilestonesOutput => {
    requirePatient(db, patient_id);

    const conditions: SQL[] = [eq(recoveryMilestones.patientId, patient_id)];
    if (status !== undefined) conditions.push(eq(recoveryMilestones.status, status));

    const rows = db
      .select()
      .from(recoveryMilestones)
      .where(and(...conditions))
      .orderBy(
        asc(sql`${recoveryMilestones.targetDate} is null`),
        asc(recoveryMilestones.targetDate),
        asc(recoveryMilestones.title),
      )
      .all();

    const counts: Record<MilestoneStatus, number> = { pending: 0, achieved: 0, missed: 0 };
    for (const row of db
      .select({ status: recoveryMilestones.status, count: sql<number>`count(*)` })
      .from(recoveryMilestones)
      .where(eq(recoveryMilestones.patientId, patient_id))
      .groupBy(recoveryMilestones.status)
      .all())
      counts[row.status] = row.count;

    return { milestones: rows.map(toRecoveryMilestoneInput), counts };
  };
