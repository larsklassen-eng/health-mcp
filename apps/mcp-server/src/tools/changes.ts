import type { RecordChange } from "@health-mcp/shared";

export type { RecordChangesOutput as ChangesOutput } from "@health-mcp/shared";
export type FieldChange = RecordChange;

/** A change, leaving `before` out when the field was empty. */
export const change = (
  field: string,
  before: string | null | undefined,
  after: string,
): FieldChange => ({ field, ...(before != null && before !== "" && { before }), after });

/** `YYYY-MM-DD` of a time, in UTC. */
export const isoDay = (time: Date) => time.toISOString().slice(0, 10);
