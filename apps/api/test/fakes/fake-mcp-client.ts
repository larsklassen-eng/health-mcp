import type { McpToolArgs, McpToolName } from "@health-mcp/shared";

import { type McpCallOptions, McpClient, type McpToolResult } from "../../src/mcp/mcp-client.js";

type Handler = (
  args: Record<string, unknown>,
  patientId: string,
  options: McpCallOptions,
) => McpToolResult | Promise<McpToolResult>;

/** What the default handler returns for a dry run: one change naming the tool. */
export const fakePreview = (name: string) => [{ field: "tool", after: name }];

/**
 * {@link McpClient} for tests. Offer tools with `offer()`; every call is
 * recorded in `calls` with the `patientId` the api supplied, and `dryRun` when set.
 */
export class FakeMcpClient extends McpClient {
  readonly calls: {
    patientId: string;
    name: string;
    args: Record<string, unknown>;
    dryRun?: true;
  }[] = [];
  private readonly handlers = new Map<string, Handler>();
  private listError: Error | undefined;

  /**
   * Offers `name`; by default it returns `{ ok: true, tool: name }`, or on a
   * dry run `{ changes: fakePreview(name) }`.
   */
  offer(
    name: string,
    handler: Handler = (_args, _patientId, { dryRun }) => ({
      output: dryRun ? { changes: fakePreview(name) } : { ok: true, tool: name },
      isError: false,
    }),
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
    options: McpCallOptions = {},
  ): Promise<McpToolResult> {
    const record = { ...(args as Record<string, unknown>) };
    this.calls.push({ patientId, name, args: record, ...(options.dryRun && { dryRun: true }) });
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`FakeMcpClient: tool ${name} is not offered`);
    return handler(record, patientId, options);
  }
}
