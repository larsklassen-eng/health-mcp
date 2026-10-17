import { z } from "zod";

/** Environment variables read by apps/api. The repo-root `.env` is loaded at startup (`src/load-env.ts`). */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Origin of apps/web, allowed by CORS. */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** SQLite file; relative paths resolve from the repo root (see @health-mcp/db). */
  DATABASE_PATH: z.string().min(1).optional(),
  /** Needed for chat. The app starts without it; LLM requests then fail with a clear error. */
  OPENROUTER_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined), // `OPENROUTER_API_KEY=` in .env means "not set"
  /** OpenRouter model slug used for chat. */
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-opus-5.5"),
  /**
   * Route only to providers with zero data retention (prompts are not stored).
   * Providers that collect data for training are always excluded, whatever this is set to.
   */
  OPENROUTER_ZDR: z.stringbool().default(true),
  /** apps/mcp-server endpoint. Only loopback URLs make sense: the server listens on localhost only. */
  MCP_URL: z.url().default("http://127.0.0.1:3002/mcp"),
  /**
   * Shared secret for apps/mcp-server (same value as in its config). Without it,
   * chat still works but the model gets no tools.
   */
  MCP_AUTH_TOKEN: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Output token cap per model turn. OpenRouter reserves credit for this many tokens on every request. */
  LLM_MAX_TOKENS: z.coerce.number().int().min(256).max(128_000).default(16_000),
  /**
   * Characters of earlier chat messages sent with each question (about 4 per token).
   * Older messages beyond this are left out, and the model is told so.
   */
  CHAT_HISTORY_MAX_CHARS: z.coerce.number().int().min(1_000).max(1_000_000).default(40_000),
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
