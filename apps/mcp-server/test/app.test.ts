import { request as httpRequest } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startTestServer, type TestServer } from "./helpers.js";

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => {
  await server.close();
});

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

const post = (headers: Record<string, string>, body: unknown = initialize) =>
  fetch(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

/** fetch() cannot override the Host header, so this uses node:http. */
const statusWithHost = (host: string) =>
  new Promise<number>((resolve, reject) => {
    const { port } = new URL(server.url);
    httpRequest({ host: "127.0.0.1", port, path: "/health", headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    })
      .on("error", reject)
      .end();
  });

describe("authentication", () => {
  it("accepts the shared token", async () => {
    const client = await server.connect();
    expect(client.getServerVersion()).toMatchObject({ name: "health-mcp" });
  });

  it.each([
    ["no token", {}],
    ["a wrong token", { Authorization: "Bearer wrong-token-0123456789abcdef0123456789" }],
    [
      "the token without the Bearer scheme",
      { Authorization: "test-token-0123456789abcdef0123456789abcdef" },
    ],
  ])("rejects %s with 401", async (_, headers) => {
    const response = await post(headers);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("rejects an MCP client with the wrong token", async () => {
    await expect(server.connect("wrong-token-0123456789abcdef0123456789")).rejects.toThrow();
  });
});

describe("HTTP", () => {
  it("serves GET /health without a token", async () => {
    const response = await fetch(`${server.url}/health`);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("rejects requests whose Host is not localhost (DNS rebinding protection)", async () => {
    expect(await statusWithHost("evil.example")).toBe(403);
    expect(await statusWithHost("localhost")).toBe(200);
  });

  it.each(["GET", "DELETE"])(
    "answers %s /mcp with 405, since the server is stateless",
    async (method) => {
      const response = await fetch(`${server.url}/mcp`, {
        method,
        headers: { Authorization: "Bearer test-token-0123456789abcdef0123456789abcdef" },
      });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    },
  );

  it("does not keep sessions between requests", async () => {
    const response = await post({
      Authorization: "Bearer test-token-0123456789abcdef0123456789abcdef",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });
});
