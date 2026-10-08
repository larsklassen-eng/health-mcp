import path from "node:path";

/** Relative to the repo root. The `data/` folder is git-ignored. */
export const DEFAULT_DATABASE_PATH = "data/health.db";

/**
 * Resolves the SQLite file path from `DATABASE_PATH`, falling back to
 * {@link DEFAULT_DATABASE_PATH}. Relative paths resolve against `cwd`.
 */
export function resolveDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return path.resolve(cwd, env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH);
}
