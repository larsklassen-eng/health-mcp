import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnvFile, ROOT_ENV_FILE } from "../src/env-file.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "env-file-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (content: string) => {
  const file = path.join(dir, ".env");
  writeFileSync(file, content);
  return file;
};

describe("loadEnvFile", () => {
  it("defaults to the repo-root .env", () => {
    expect(ROOT_ENV_FILE).toMatch(/health-mcp[/\\]\.env$/);
  });

  it("loads variables, ignoring comments and blank lines", () => {
    const env: NodeJS.ProcessEnv = {};
    const file = write("# comment\nPORT=3001\n\nMCP_URL=http://127.0.0.1:3002/mcp\nEMPTY=\n");

    expect(loadEnvFile(file, env).sort()).toEqual(["EMPTY", "MCP_URL", "PORT"]);
    expect(env).toEqual({ PORT: "3001", MCP_URL: "http://127.0.0.1:3002/mcp", EMPTY: "" });
  });

  it("keeps variables that are already set, like node --env-file", () => {
    const env: NodeJS.ProcessEnv = { PORT: "3201", MCP_AUTH_TOKEN: "" };
    const file = write("PORT=3001\nMCP_AUTH_TOKEN=from-file\nOTHER=x\n");

    expect(loadEnvFile(file, env)).toEqual(["OTHER"]);
    expect(env).toEqual({ PORT: "3201", MCP_AUTH_TOKEN: "", OTHER: "x" });
  });

  it("does nothing when the file does not exist", () => {
    const env: NodeJS.ProcessEnv = {};

    expect(loadEnvFile(path.join(dir, "missing.env"), env)).toEqual([]);
    expect(env).toEqual({});
  });
});
