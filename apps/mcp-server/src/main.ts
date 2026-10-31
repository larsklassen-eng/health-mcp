import "./load-env.js";

import { randomBytes } from "node:crypto";

import { createDb, resolveDatabasePath } from "@health-mcp/db";
import { HashingEmbedder, LocalEmbedder, LocalReranker } from "@health-mcp/rag";

import { createApp, MCP_PATH } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
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
      `(database: ${connection.path})`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => connection.close());
  });
}
