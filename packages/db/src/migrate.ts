/** CLI: `yarn db:migrate` creates the database file if needed and applies pending migrations. */
import { createDb, migrateDb } from "./client.js";

const connection = createDb();
try {
  migrateDb(connection.db);
  console.log(`Database is up to date: ${connection.path}`);
} finally {
  connection.close();
}
