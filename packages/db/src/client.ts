import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { MIGRATIONS_FOLDER, resolveDatabasePath } from "./config.js";
import * as schema from "./schema.js";

export type HealthDb = BetterSQLite3Database<typeof schema>;

export interface DbConnection {
  db: HealthDb;
  /** Absolute path of the opened file, or `:memory:`. */
  path: string;
  close: () => void;
}

export interface CreateDbOptions {
  /** Defaults to {@link resolveDatabasePath}. Pass `:memory:` for a throwaway database. */
  path?: string;
}

/**
 * Opens the SQLite database, creating the file and its folder if needed.
 * Does not create tables; run {@link migrateDb} (or `yarn db:migrate`) for that.
 */
export function createDb(options: CreateDbOptions = {}): DbConnection {
  const filePath = options.path ?? resolveDatabasePath();
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const sqlite = new Database(filePath);
  // WAL lets apps/api and apps/mcp-server use the same file concurrently.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  // SQLite ignores foreign keys (and ON DELETE CASCADE) unless enabled per connection.
  sqlite.pragma("foreign_keys = ON");

  return {
    db: drizzle({ client: sqlite, schema }),
    path: filePath,
    close: () => sqlite.close(),
  };
}

/** Applies any pending migrations from {@link MIGRATIONS_FOLDER}. */
export function migrateDb(db: HealthDb): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
