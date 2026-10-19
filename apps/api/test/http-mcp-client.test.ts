import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { HttpMcpClient, McpUnavailableError } from "../src/mcp/http-mcp-client.js";

const TOKEN = "test-token-0123456789abcdef0123456789abcdef";

/** A stateless MCP server like apps/mcp-server, whose tools echo what they received. */
function createTestServer() {
  const received: { authorization: string | undefined; tool: string; args: unknown }[] = [];
  let authorization: string | undefined;

  const mcpServer = () => {
    const server = new McpServer({ name: "test", version: "0" });
    const echo = (tool: string) => async (args: unknown) => {
      received.push({ authorization, tool, args });
      return { content: [{ type: "text" as const, text: JSON.stringify(args) }] };
    };
    // Loose schemas, so the test sees every key the client sent.
    server.registerTool(
      "get_patient_profile",
      { inputSchema: z.looseObject({ patient_id: z.string() }) },
      echo("get_patient_profile"),
    );
    server.registerTool(
      "get_lab_results",
      { inputSchema: z.looseObject({ patient_id: z.string() }) },
      echo("get_lab_results"),
    );
    server.registerTool("get_medications", { inputSchema: z.looseObject({}) }, async () => ({
      content: [{ type: "text" as const, text: "Patient not found." }],
      isError: true,
    }));
    return server;
  };

  const http = createServer(async (req: IncomingMessage, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    authorization = req.headers.authorization;
    const server = mcpServer();
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => void server.close());
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res);
  });
  return { http, received };
}

let http: Server;
let received: ReturnType<typeof createTestServer>["received"];
let url: string;
let client: HttpMcpClient | undefined;

beforeEach(async () => {
  ({ http, received } = createTestServer());
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  http.closeAllConnections();
  await new Promise((resolve) => http.close(resolve));
});

/** `authToken` has no default on purpose: passing `undefined` must mean "no token". */
const connectWith = (authToken: string | undefined) =>
  (client = new HttpMcpClient({ url, authToken, timeoutMs: 2000 }));
const connect = () => connectWith(TOKEN);

describe("HttpMcpClient", () => {
  it("lists the server's tool names", async () => {
    expect(await connect().listToolNames()).toEqual([
      "get_patient_profile",
      "get_lab_results",
      "get_medications",
    ]);
  });

  it("sends the bearer token and adds patient_id to the arguments", async () => {
    const result = await connect().callTool("p1", "get_lab_results", {
      test_names: ["Hemoglobin"],
      limit: 5,
    });

    expect(received).toEqual([
      {
        authorization: `Bearer ${TOKEN}`,
        tool: "get_lab_results",
        args: { test_names: ["Hemoglobin"], limit: 5, patient_id: "p1" },
      },
    ]);
    expect(result).toEqual({
      output: { test_names: ["Hemoglobin"], limit: 5, patient_id: "p1" },
      isError: false,
    });
  });

  it("never lets the arguments override patient_id", async () => {
    await connect().callTool("p1", "get_patient_profile", { patient_id: "someone-else" } as never);

    expect(received[0]?.args).toEqual({ patient_id: "p1" });
  });

  it("returns tool errors as results, with non-JSON text kept as text", async () => {
    expect(await connect().callTool("p1", "get_medications", { status: "active" })).toEqual({
      output: "Patient not found.",
      isError: true,
    });
  });

  it("reuses one connection for several calls", async () => {
    const mcp = connect();
    await mcp.callTool("p1", "get_patient_profile", {});
    await mcp.callTool("p2", "get_patient_profile", {});

    expect(received.map((r) => (r.args as { patient_id: string }).patient_id)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("fails with McpUnavailableError without a token, without contacting the server", async () => {
    await expect(connectWith(undefined).listToolNames()).rejects.toThrow(
      new McpUnavailableError("MCP_AUTH_TOKEN is not set"),
    );
    expect(received).toEqual([]);
  });

  it("fails with McpUnavailableError for a wrong token", async () => {
    await expect(connectWith("wrong-token").listToolNames()).rejects.toBeInstanceOf(
      McpUnavailableError,
    );
  });

  it("fails with McpUnavailableError while the server is down, then reconnects", async () => {
    const { port } = http.address() as AddressInfo;
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
    const mcp = connect();

    await expect(mcp.listToolNames()).rejects.toBeInstanceOf(McpUnavailableError);

    ({ http, received } = createTestServer());
    await new Promise<void>((resolve) => http.listen(port, "127.0.0.1", resolve));
    expect(await mcp.listToolNames()).toContain("get_patient_profile");
  });

  it("rethrows an abort unchanged", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await connect()
      .callTool("p1", "get_patient_profile", {}, controller.signal)
      .catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(McpUnavailableError);
    expect(received).toEqual([]);
  });
});
