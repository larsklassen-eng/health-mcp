import { z } from "zod";

/** Environment variables read by apps/api. Loaded from the repo-root `.env` by the start scripts. */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Origin of apps/web, allowed by CORS. */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** SQLite file; relative paths resolve from the repo root (see @health-mcp/db). */
  DATABASE_PATH: z.string().min(1).optional(),
  /** Required once the chat module is added. */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses `process.env`, failing fast with a readable message if anything is invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
