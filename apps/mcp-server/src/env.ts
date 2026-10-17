import { z } from "zod";

/** Environment variables read by apps/mcp-server. The repo-root `.env` is loaded at startup (`src/load-env.ts`). */
export const EnvSchema = z.object({
  /**
   * Only loopback addresses are allowed: the server trusts the `patient_id` it
   * is given, so it must only be reachable by apps/api on the same machine.
   */
  MCP_HOST: z.enum(["127.0.0.1", "localhost", "::1"]).default("127.0.0.1"),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  /**
   * Shared secret apps/api sends as `Authorization: Bearer <token>`. Generate with `openssl rand -hex 32`.
   * Without it the server still starts (so `yarn dev` works) but rejects every request.
   */
  MCP_AUTH_TOKEN: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined) // `MCP_AUTH_TOKEN=` in .env means "not set"
    .pipe(
      z
        .string()
        .min(
          32,
          "MCP_AUTH_TOKEN must be at least 32 characters. Generate one with `openssl rand -hex 32`",
        )
        .optional(),
    ),
  /** SQLite file; relative paths resolve from the repo root (see @health-mcp/db). */
  DATABASE_PATH: z.string().min(1).optional(),
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
