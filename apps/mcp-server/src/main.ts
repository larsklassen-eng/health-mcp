import "./load-env.js";

import { randomBytes } from "node:crypto";

import { createDb, resolveDatabasePath } from "@health-mcp/db";
import { HashingEmbedder, LocalEmbedder, LocalReranker } from "@health-mcp/rag";
import { startTracing } from "@health-mcp/rag/tracing";

import { createApp, MCP_PATH } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const tracing = env.PHOENIX_COLLECTOR_ENDPOINT
  ? startTracing({
      endpoint: env.PHOENIX_COLLECTOR_ENDPOINT,
      serviceName: "mcp-server",
      apiKey: env.PHOENIX_API_KEY,
    })
  : undefined;
// Tables are created by `yarn db:migrate`, not on startup.
const connection = createDb({ path: resolveDatabasePath(env) });

let authToken = env.MCP_AUTH_TOKEN;
if (!authToken) {
  // Fail closed: a random token nobody knows, so every request is rejected.
  authToken = randomBytes(32).toString("hex");
  console.warn(
    "MCP_AUTH_TOKEN is not set, so every request will be rejected. " +
      "Generate one with `openssl rand -hex 32` and add it to .env.",
  );
}
const embedder =
  env.RAG_EMBEDDER === "local"
    ? new LocalEmbedder()
    : env.RAG_EMBEDDER === "hashing"
      ? new HashingEmbedder()
      : null;
const reranker =
  env.RAG_EMBEDDER === "local" && env.RAG_RERANKER === "local" ? new LocalReranker() : null;
const app = createApp({ db: connection.db, authToken, embedder, reranker });

const server = app.listen(env.MCP_PORT, env.MCP_HOST, () => {
  console.log(
    `MCP server listening on http://${env.MCP_HOST}:${env.MCP_PORT}${MCP_PATH} ` +
      `(database: ${connection.path})` +
      (env.PHOENIX_COLLECTOR_ENDPOINT ? `, tracing to ${env.PHOENIX_COLLECTOR_ENDPOINT}` : ""),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      connection.close();
      // Phoenix may be off (on demand in AWS): the last traces are then dropped.
      tracing?.shutdown().catch(() => undefined);
    });
  });
}
