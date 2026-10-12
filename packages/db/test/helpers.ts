import { createDb, type DbConnection, migrateDb, type NewPatientRow, patients } from "../src/index.js";

/** Fresh in-memory database with all migrations applied. */
export function createTestDb(): DbConnection {
  const connection = createDb({ path: ":memory:" });
  migrateDb(connection.db);
  return connection;
}

export function insertPatient(connection: DbConnection, overrides: Partial<NewPatientRow> = {}) {
  const [patient] = connection.db
    .insert(patients)
    .values({
      mrn: "FAKE-001",
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      diagnosis: "Synthetic meningioma",
      ...overrides,
    })
    .returning()
    .all();
  if (!patient) throw new Error("insert returned no row");
  return patient;
}

/** Runs `fn` and returns the SQLite error code it throws, or undefined. */
export function sqliteErrorCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
