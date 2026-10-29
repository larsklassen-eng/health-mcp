import { AuthModeSchema } from "@health-mcp/shared";
import { z } from "zod";

/**
 * Environment variables read by apps/api. The repo-root `.env` is loaded at
 * startup (`src/load-env.ts`).
 */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Origin of apps/web, allowed by CORS. */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** SQLite file; relative paths resolve from the repo root (see @health-mcp/db). */
  DATABASE_PATH: z.string().min(1).optional(),
  /**
   * Folder for the PNG slices of uploaded imaging studies; relative paths
   * resolve from the repo root.
   */
  IMAGING_DIR: z.string().min(1).optional(),
  /** Needed for chat. The app starts without it; LLM requests then fail with a clear error. */
  OPENROUTER_API_KEY: z
    .string()
    .optional()
    // `OPENROUTER_API_KEY=` in .env means "not set".
    .transform((value) => value?.trim() || undefined),
  /** OpenRouter model slug used for chat. */
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-opus-5.5"),
  /**
   * Route only to providers with zero data retention (prompts are not stored).
   * Providers that collect data for training are always excluded, whatever this is set to.
   */
  OPENROUTER_ZDR: z.stringbool().default(true),
  /** Let the provider cache prompts for a few minutes, so repeated input costs less. */
  OPENROUTER_PROMPT_CACHING: z.stringbool().default(true),
  /** Override the OpenRouter API base URL, e.g. a local fake server for a dry run of the evals. */
  OPENROUTER_BASE_URL: z.url().optional(),
  /** apps/mcp-server endpoint. Only loopback URLs make sense: the server listens on localhost. */
  MCP_URL: z.url().default("http://127.0.0.1:3002/mcp"),
  /**
   * Shared secret for apps/mcp-server (same value as in its config). Without it,
   * chat still works but the model gets no tools.
   */
  MCP_AUTH_TOKEN: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /**
   * Output token cap per model turn. OpenRouter reserves credit for this many
   * tokens on every request.
   */
  LLM_MAX_TOKENS: z.coerce.number().int().min(256).max(128_000).default(16_000),
  /**
   * Characters of earlier chat messages sent with each question (about 4 per token).
   * Older messages beyond this are left out, and the model is told so.
   */
  CHAT_HISTORY_MAX_CHARS: z.coerce.number().int().min(1_000).max(1_000_000).default(40_000),
  /**
   * Sign-in. `google`: every route except health and sign-in needs a session.
   * `off`: anyone who can reach the api may use it. Defaults to `google` in
   * production (NODE_ENV=production, as in the Docker images), `off` otherwise.
   */
  AUTH_MODE: AuthModeSchema.optional(),
  /** OAuth client of a Google Cloud project ("Web application" type). */
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  /**
   * Who may sign in: comma-separated email addresses, e.g.
   * `ana@example.com,ben@example.com`. Checked on every request, so removing
   * an address ends that person's sessions.
   */
  AUTH_ALLOWED_EMAILS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  /**
   * Key that signs session and sign-in tokens; at least 32 characters
   * (`openssl rand -hex 32`). Changing it signs everyone out.
   */
  SESSION_SECRET: optionalSecret,
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
});

export const EnvSchema = BaseEnvSchema.transform((env, context) => {
  const AUTH_MODE = env.AUTH_MODE ?? (env.NODE_ENV === "production" ? "google" : "off");
  if (AUTH_MODE === "google") {
    const missing = (
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET"] as const
    ).filter((key) => !env[key]);
    for (const key of missing)
      context.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required when AUTH_MODE is google`,
      });
    if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32)
      context.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)",
      });
    if (env.AUTH_ALLOWED_EMAILS.length === 0)
      context.addIssue({
        code: "custom",
        path: ["AUTH_ALLOWED_EMAILS"],
        message: "AUTH_ALLOWED_EMAILS must list who may sign in when AUTH_MODE is google",
      });
  }
  return { ...env, AUTH_MODE };
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
