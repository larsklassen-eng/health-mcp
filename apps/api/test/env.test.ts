import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("loadEnv", () => {
  it("applies defaults", () => {
    expect(loadEnv({})).toEqual({ NODE_ENV: "development", PORT: 3001, WEB_ORIGIN: "http://localhost:3000" });
  });

  it("coerces PORT to a number", () => {
    expect(loadEnv({ PORT: "4000" }).PORT).toBe(4000);
  });

  it.each([
    ["a non-numeric PORT", { PORT: "abc" }, "PORT"],
    ["an out-of-range PORT", { PORT: "70000" }, "PORT"],
    ["an invalid WEB_ORIGIN", { WEB_ORIGIN: "not a url" }, "WEB_ORIGIN"],
    ["an unknown NODE_ENV", { NODE_ENV: "staging" }, "NODE_ENV"],
    ["an empty OPENROUTER_API_KEY", { OPENROUTER_API_KEY: "" }, "OPENROUTER_API_KEY"],
  ])("fails fast on %s and names the variable", (_label, env, variable) => {
    expect(() => loadEnv(env)).toThrow(variable);
  });
});
