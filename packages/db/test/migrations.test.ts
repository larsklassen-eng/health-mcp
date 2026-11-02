import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { createDb, type DbConnection, MIGRATIONS_FOLDER, migrateDb } from "../src/index.js";

/** A copy of the migrations folder that stops after `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "health-mcp-migrations-"));
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (last < 0) throw new Error(`no migration ${lastTag}`);
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

let connection: DbConnection | undefined;
let folder: string | undefined;
afterEach(() => {
  connection?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("0005_users_names_and_patient_owners", () => {
  it("splits existing names into first and last names, and leaves patients unassigned", () => {
    connection = createDb({ path: ":memory:" });
    folder = migrationsUpTo("0004_users");
    migrate(connection.db, { migrationsFolder: folder });
    for (const [email, name] of [
      ["ana@example.com", "Ana María Test"],
      ["ben@example.com", "Ben"],
      ["cy@example.com", null],
    ])
      connection.db.run(
        sql`insert into users (id, email, name, password_hash) values (${email}, ${email}, ${name}, 'h')`,
      );
    connection.db.run(sql`
      insert into patients (id, mrn, first_name, last_name, date_of_birth, sex, diagnosis)
      values ('p1', 'FAKE-001', 'Pat', 'Test', '1980-01-01', 'female', 'Synthetic')`);

    migrateDb(connection.db);

    expect(
      connection.db.all(sql`select email, first_name, last_name from users order by email`),
    ).toEqual([
      { email: "ana@example.com", first_name: "Ana", last_name: "María Test" },
      { email: "ben@example.com", first_name: "Ben", last_name: "" },
      { email: "cy@example.com", first_name: "", last_name: "" },
    ]);
    expect(connection.db.all(sql`select owner_id from patients`)).toEqual([{ owner_id: null }]);
  });
});
