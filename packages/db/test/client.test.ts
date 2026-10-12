import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb, migrateDb } from "../src/index.js";
import { createTestDb } from "./helpers.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createDb", () => {
  it("creates missing folders and enables WAL for file databases", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "health-db-"));
    tempDirs.push(dir);
    const connection = createDb({ path: path.join(dir, "nested", "health.db") });

    expect(connection.db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    connection.close();
  });

  it("enables foreign keys on every connection", () => {
    const connection = createDb({ path: ":memory:" });
    expect(connection.db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    connection.close();
  });
});

describe("migrateDb", () => {
  it("creates all tables", () => {
    const connection = createTestDb();
    const tables = connection.db.$client
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "__drizzle_migrations",
      "chat_messages",
      "lab_results",
      "medications",
      "patients",
      "recovery_milestones",
      "symptoms",
      "vital_signs",
    ]);
    connection.close();
  });

  it("is safe to run twice", () => {
    const connection = createTestDb();
    expect(() => migrateDb(connection.db)).not.toThrow();
    connection.close();
  });
});
