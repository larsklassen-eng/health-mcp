/**
 * True if `error` (or its cause, when wrapped by Drizzle) is a SQLite UNIQUE
 * constraint violation.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}
