import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("loadEnv", () => {
  it("applies defaults", () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      WEB_ORIGIN: "http://localhost:3000",
      OPENROUTER_MODEL: "anthropic/claude-opus-5.5",
      OPENROUTER_ZDR: true,
      OPENROUTER_PROMPT_CACHING: true,
      LLM_MAX_TOKENS: 16_000,
      CHAT_HISTORY_MAX_CHARS: 40_000,
      MCP_URL: "http://127.0.0.1:3002/mcp",
      AUTH_MODE: "off",
      AUTH_ALLOWED_EMAILS: [],
      SESSION_TTL_HOURS: 12,
    });
  });

  describe("sign-in", () => {
    const google = {
      AUTH_MODE: "google",
      GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "secret",
      SESSION_SECRET: "s".repeat(32),
      AUTH_ALLOWED_EMAILS: " Ana@Example.com, ben@example.com ,",
    };

    it("is off by default, and on (google) by default in production", () => {
      expect(loadEnv({}).AUTH_MODE).toBe("off");
      const { AUTH_MODE: _, ...rest } = google;
      expect(loadEnv({ ...rest, NODE_ENV: "production" }).AUTH_MODE).toBe("google");
    });

    it("lowercases and trims the allowlist", () => {
      expect(loadEnv(google).AUTH_ALLOWED_EMAILS).toEqual(["ana@example.com", "ben@example.com"]);
    });

    it.each(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "AUTH_ALLOWED_EMAILS"])(
      "requires %s when sign-in is on",
      (key) => {
        expect(() => loadEnv({ ...google, [key]: "" })).toThrow(key);
      },
    );

    it("refuses to start in production without the sign-in settings", () => {
      expect(() => loadEnv({ NODE_ENV: "production" })).toThrow("GOOGLE_CLIENT_ID");
      expect(loadEnv({ NODE_ENV: "production", AUTH_MODE: "off" }).AUTH_MODE).toBe("off");
    });

    it("rejects a short session secret", () => {
      expect(() => loadEnv({ ...google, SESSION_SECRET: "short" })).toThrow("at least 32");
    });
  });

  it("accepts an OpenRouter base URL override", () => {
    expect(loadEnv({ OPENROUTER_BASE_URL: "http://127.0.0.1:9/api/v1" }).OPENROUTER_BASE_URL).toBe(
      "http://127.0.0.1:9/api/v1",
    );
    expect(() => loadEnv({ OPENROUTER_BASE_URL: "not a url" })).toThrow("OPENROUTER_BASE_URL");
  });

  it.each(["", "   "])("treats MCP_AUTH_TOKEN=%j as not set", (value) => {
    expect(loadEnv({ MCP_AUTH_TOKEN: value }).MCP_AUTH_TOKEN).toBeUndefined();
  });

  it.each(["", "   "])("treats OPENROUTER_API_KEY=%j (as in .env.example) as not set", (value) => {
    expect(loadEnv({ OPENROUTER_API_KEY: value }).OPENROUTER_API_KEY).toBeUndefined();
  });

  it("keeps a real OPENROUTER_API_KEY", () => {
    expect(loadEnv({ OPENROUTER_API_KEY: "sk-or-test" }).OPENROUTER_API_KEY).toBe("sk-or-test");
  });

  it.each([
    ["false", false],
    ["0", false],
    ["true", true],
    ["1", true],
  ])("parses OPENROUTER_ZDR=%s as %s", (value, expected) => {
    expect(loadEnv({ OPENROUTER_ZDR: value }).OPENROUTER_ZDR).toBe(expected);
  });

  it("coerces PORT to a number", () => {
    expect(loadEnv({ PORT: "4000" }).PORT).toBe(4000);
  });

  it.each([
    ["a non-numeric PORT", { PORT: "abc" }, "PORT"],
    ["an out-of-range PORT", { PORT: "70000" }, "PORT"],
    ["an invalid WEB_ORIGIN", { WEB_ORIGIN: "not a url" }, "WEB_ORIGIN"],
    ["an unknown NODE_ENV", { NODE_ENV: "staging" }, "NODE_ENV"],
    ["an empty OPENROUTER_MODEL", { OPENROUTER_MODEL: "" }, "OPENROUTER_MODEL"],
    ["a non-boolean OPENROUTER_ZDR", { OPENROUTER_ZDR: "maybe" }, "OPENROUTER_ZDR"],
    ["an LLM_MAX_TOKENS below 256", { LLM_MAX_TOKENS: "100" }, "LLM_MAX_TOKENS"],
    ["an LLM_MAX_TOKENS above 128000", { LLM_MAX_TOKENS: "200000" }, "LLM_MAX_TOKENS"],
    [
      "a CHAT_HISTORY_MAX_CHARS below 1000",
      { CHAT_HISTORY_MAX_CHARS: "999" },
      "CHAT_HISTORY_MAX_CHARS",
    ],
  ])("fails fast on %s and names the variable", (_label, env, variable) => {
    expect(() => loadEnv(env)).toThrow(variable);
  });
});
