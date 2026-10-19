import { type HealthDb, labResults, toLabResultInput } from "@health-mcp/db";
import type { LabResultInput } from "@health-mcp/shared";
import { and, asc, desc, eq, gte, type SQL, sql } from "drizzle-orm";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

export interface LabResultsOutput {
  /** Newest first. */
  results: LabResultInput[];
  /** True when more results match than `limit` allowed. */
  hasMore: boolean;
  /** Requested test names the patient has no results for, so the model can retry. */
  unknownTests?: string[];
  /** The patient's test names, only when `unknownTests` is set. */
  availableTests?: string[];
}

export const getLabResults =
  (db: HealthDb): ToolHandler<"get_lab_results"> =>
  ({ patient_id, test_names, since, limit }): LabResultsOutput => {
    requirePatient(db, patient_id);
    const requested = test_names?.map((name) => name.trim());

    const conditions: SQL[] = [eq(labResults.patientId, patient_id)];
    if (requested) {
      const names = sql.join(
        requested.map((name) => sql`${name.toLowerCase()}`),
        sql`, `,
      );
      conditions.push(sql`lower(${labResults.testName}) in (${names})`);
    }
    // Stored times are UTC ISO strings, so `since` is converted to the same form
    // before comparing text.
    if (since !== undefined)
      conditions.push(gte(labResults.collectedAt, new Date(since).toISOString()));

    const rows = db
      .select()
      .from(labResults)
      .where(and(...conditions))
      .orderBy(desc(labResults.collectedAt), asc(labResults.testName))
      .limit(limit + 1)
      .all();

    const output: LabResultsOutput = {
      results: rows.slice(0, limit).map(toLabResultInput),
      hasMore: rows.length > limit,
    };
    if (requested) {
      const available = db
        .selectDistinct({ testName: labResults.testName })
        .from(labResults)
        .where(eq(labResults.patientId, patient_id))
        .orderBy(asc(labResults.testName))
        .all()
        .map((row) => row.testName);
      const known = new Set(available.map((name) => name.toLowerCase()));
      const unknown = requested.filter((name) => !known.has(name.toLowerCase()));
      if (unknown.length > 0)
        Object.assign(output, { unknownTests: unknown, availableTests: available });
    }
    return output;
  };
