import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { REPO_ROOT } from "@health-mcp/db";

const API_MAIN = path.join(REPO_ROOT, "apps/api/dist/main.js");
const MCP_MAIN = path.join(REPO_ROOT, "apps/mcp-server/dist/main.js");
const STARTUP_TIMEOUT_MS = 20_000;

export interface Stack {
  /** Base URL of apps/api, e.g. `http://127.0.0.1:54321`. */
  apiUrl: string;
  close: () => Promise<void>;
}

/** A free loopback port, found by briefly listening on port 0. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

interface Service {
  child: ChildProcess;
  /** Everything the process printed, shown only if it fails to start. */
  output: () => string;
}

function startService(main: string, env: Record<string, string>): Service {
  const child = spawn(process.execPath, [main], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

async function waitForHealth(name: string, url: string, service: Service): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) break;
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${name} did not start.\n${service.output()}`);
}

async function stop({ child }: Service): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

/**
 * Starts apps/mcp-server and apps/api from their builds on free loopback
 * ports, both on `databasePath`, with a fresh MCP token. Every other setting
 * (the OpenRouter key and model) comes from the environment or the root `.env`.
 */
export async function startStack(databasePath: string): Promise<Stack> {
  for (const main of [API_MAIN, MCP_MAIN])
    if (!existsSync(main)) throw new Error(`${main} is missing. Run \`yarn build\` first.`);

  const [mcpPort, apiPort] = [await freePort(), await freePort()];
  const token = randomBytes(32).toString("hex");
  const mcp = startService(MCP_MAIN, {
    DATABASE_PATH: databasePath,
    MCP_HOST: "127.0.0.1",
    MCP_PORT: String(mcpPort),
    MCP_AUTH_TOKEN: token,
  });
  const api = startService(API_MAIN, {
    DATABASE_PATH: databasePath,
    PORT: String(apiPort),
    MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`,
    MCP_AUTH_TOKEN: token,
  });

  try {
    await waitForHealth("apps/mcp-server", `http://127.0.0.1:${mcpPort}/health`, mcp);
    await waitForHealth("apps/api", `http://127.0.0.1:${apiPort}/health`, api);
  } catch (error) {
    await Promise.all([stop(mcp), stop(api)]);
    throw error;
  }

  return {
    apiUrl: `http://127.0.0.1:${apiPort}`,
    close: async () => {
      await Promise.all([stop(api), stop(mcp)]);
    },
  };
}
