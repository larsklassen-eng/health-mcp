import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/env.js";

const token = "a".repeat(32);

describe("loadEnv", () => {
  it("defaults to 127.0.0.1:3002", () => {
    expect(loadEnv({ MCP_AUTH_TOKEN: token })).toEqual({ MCP_HOST: "127.0.0.1", MCP_PORT: 3002, MCP_AUTH_TOKEN: token });
  });

  it.each([["missing", {}], ["empty", { MCP_AUTH_TOKEN: "  " }]])("treats a %s MCP_AUTH_TOKEN as not set", (_, source) => {
    expect(loadEnv(source).MCP_AUTH_TOKEN).toBeUndefined();
  });

  it("rejects a short token", () => {
    expect(() => loadEnv({ MCP_AUTH_TOKEN: "short" })).toThrow(/at least 32 characters.*openssl rand -hex 32/);
  });

  it("refuses to listen on a non-loopback address", () => {
    expect(() => loadEnv({ MCP_AUTH_TOKEN: token, MCP_HOST: "0.0.0.0" })).toThrow(/MCP_HOST/);
  });
});
