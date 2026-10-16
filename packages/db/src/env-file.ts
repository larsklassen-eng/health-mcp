import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import { REPO_ROOT } from "./config.js";

/** The repo-root `.env` (git-ignored), shared by apps/api and apps/mcp-server. */
export const ROOT_ENV_FILE = path.join(REPO_ROOT, ".env");

/**
 * Loads `file` into `env` if it exists. Variables that are already set (in the
 * shell, or inline like `PORT=3201 yarn start`) win, as with `node --env-file`.
 *
 * The apps call this at startup instead of using `--env-file`, because
 * `node --watch` combined with `--env-file` kept restarting the apps in
 * `yarn dev` without any file changing (Node 26).
 */
export function loadEnvFile(file = ROOT_ENV_FILE, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(file)) return [];
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    loaded.push(key);
  }
  return loaded;
}
