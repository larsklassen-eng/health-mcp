import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file lives at `packages/db/{src,dist}/config.*`). */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Relative to the repo root. The `data/` folder is git-ignored. */
export const DEFAULT_DATABASE_PATH = "data/health.db";

/** Drizzle migrations generated from `src/schema.ts`, shipped with this package. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Resolves the SQLite file path from `DATABASE_PATH`, falling back to
 * {@link DEFAULT_DATABASE_PATH}. Relative paths resolve against the repo root,
 * so apps/api and apps/mcp-server open the same file whatever their cwd is.
 * `:memory:` is passed through unchanged.
 */
export function resolveDatabasePath(env: { DATABASE_PATH?: string | undefined } = process.env): string {
  const configured = env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  // `:memory:` is SQLite's in-memory database, not a file name.
  return configured === ":memory:" ? configured : path.resolve(REPO_ROOT, configured);
}
