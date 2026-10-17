import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_DATABASE_PATH, REPO_ROOT, resolveDatabasePath } from "../src/index.js";

describe("resolveDatabasePath", () => {
  it("defaults to data/health.db at the repo root", () => {
    expect(resolveDatabasePath({})).toBe(path.join(REPO_ROOT, DEFAULT_DATABASE_PATH));
  });

  it("resolves relative paths from the repo root, not the cwd", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "tmp/other.db" })).toBe(
      path.join(REPO_ROOT, "tmp/other.db"),
    );
  });

  it("keeps absolute paths", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "/var/data/health.db" })).toBe(
      "/var/data/health.db",
    );
  });

  it("passes :memory: through instead of creating a file with that name", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: ":memory:" })).toBe(":memory:");
  });

  it("points REPO_ROOT at the monorepo root", () => {
    expect(REPO_ROOT).toBe(path.resolve(import.meta.dirname, "../../..") + path.sep);
  });
});
