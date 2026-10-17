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
  /** The patient's test names, only when a `test_name` filter matched nothing, so the model can retry. */
  availableTests?: string[];
}

export const getLabResults =
  (db: HealthDb): ToolHandler<"get_lab_results"> =>
  ({ patient_id, test_name, since, limit }): LabResultsOutput => {
    requirePatient(db, patient_id);

    const conditions: SQL[] = [eq(labResults.patientId, patient_id)];
    if (test_name !== undefined)
      conditions.push(sql`${labResults.testName} = ${test_name.trim()} collate nocase`);
    // Stored times are UTC ISO strings, so `since` is converted to the same form before comparing text.
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
    if (rows.length === 0 && test_name !== undefined) {
      output.availableTests = db
        .selectDistinct({ testName: labResults.testName })
        .from(labResults)
        .where(eq(labResults.patientId, patient_id))
        .orderBy(asc(labResults.testName))
        .all()
        .map((row) => row.testName);
    }
    return output;
  };
