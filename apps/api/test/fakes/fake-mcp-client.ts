import type { McpToolArgs, McpToolName } from "@health-mcp/shared";

import { McpClient, type McpToolResult } from "../../src/mcp/mcp-client.js";

type Handler = (
  args: Record<string, unknown>,
  patientId: string,
  signal?: AbortSignal,
) => McpToolResult | Promise<McpToolResult>;

/**
 * {@link McpClient} for tests. Offer tools with `offer()`; every call is
 * recorded in `calls` with the `patientId` the api supplied.
 */
export class FakeMcpClient extends McpClient {
  readonly calls: { patientId: string; name: string; args: Record<string, unknown> }[] = [];
  private readonly handlers = new Map<string, Handler>();
  private listError: Error | undefined;

  /** Offers `name`; by default it returns `{ ok: true, tool: name }`. */
  offer(
    name: string,
    handler: Handler = () => ({ output: { ok: true, tool: name }, isError: false }),
  ): this {
    this.handlers.set(name, handler);
    return this;
  }

  /** Makes `listToolNames` fail, as when the MCP server is down. */
  failListing(error = new Error("connect ECONNREFUSED 127.0.0.1:3002")): this {
    this.listError = error;
    return this;
  }

  async listToolNames(): Promise<string[]> {
    if (this.listError) throw this.listError;
    return [...this.handlers.keys()];
  }

  async callTool<T extends McpToolName>(
    patientId: string,
    name: T,
    args: McpToolArgs<T>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    const record = { ...(args as Record<string, unknown>) };
    this.calls.push({ patientId, name, args: record });
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`FakeMcpClient: tool ${name} is not offered`);
    return handler(record, patientId, signal);
  }
}
