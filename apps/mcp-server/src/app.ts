import { createHash, timingSafeEqual } from "node:crypto";

import type { HealthDb } from "@health-mcp/db";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express, { type Express, type RequestHandler, type Response } from "express";

import { createMcpServer } from "./server.js";

export const MCP_PATH = "/mcp";

export interface AppOptions {
  db: HealthDb;
  /** Shared secret apps/api sends as a bearer token. */
  authToken: string;
}

const jsonRpcError = (res: Response, status: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Rejects requests without the shared secret. Hashing first gives equal-length buffers for a constant-time compare. */
function requireBearerToken(token: string): RequestHandler {
  const expected = digest(token);
  return (req, res, next) => {
    const header = req.get("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (given && timingSafeEqual(digest(given), expected)) return next();
    res.set("WWW-Authenticate", "Bearer");
    jsonRpcError(res, 401, "Unauthorized");
  };
}

/**
 * HTTP app serving MCP over Streamable HTTP at `POST /mcp`, stateless: each
 * request gets its own server and transport, so no sessions are kept.
 * Checks run before the body is read: Host header (DNS rebinding), then the token.
 */
export function createApp({ db, authToken }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(localhostHostValidation());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(MCP_PATH, requireBearerToken(authToken), express.json({ limit: "1mb" }));

  app.post(MCP_PATH, async (req, res) => {
    const server = createMcpServer(db);
    // No `sessionIdGenerator` means stateless mode.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      // The SDK's optional callbacks are typed `?: () => void`, which `exactOptionalPropertyTypes` rejects.
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) jsonRpcError(res, 500, "Internal server error");
    }
  });

  // Stateless: no GET stream for server-initiated messages and no sessions to DELETE.
  app.all(MCP_PATH, (_req, res) => {
    res.set("Allow", "POST");
    jsonRpcError(res, 405, "Method not allowed");
  });

  return app;
}
