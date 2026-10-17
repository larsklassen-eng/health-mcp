import type { McpToolArgs, McpToolName } from "@health-mcp/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { McpClient, type McpToolResult } from "./mcp-client.js";

export interface HttpMcpClientOptions {
  url: string;
  /** Shared secret sent as a bearer token. Without it, every call fails with {@link McpUnavailableError}. */
  authToken: string | undefined;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

/** The MCP server is not configured or could not be reached. */
export class McpUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpUnavailableError";
  }
}

/** Parses JSON text content; falls back to the raw text. */
function toOutput(result: CallToolResult): unknown {
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * {@link McpClient} for apps/mcp-server over Streamable HTTP. The server is
 * stateless, so one connection is opened lazily and reused; if connecting
 * fails, the next call tries again.
 */
export class HttpMcpClient extends McpClient {
  private client: Promise<Client> | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpMcpClientOptions) {
    super();
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async listToolNames(signal?: AbortSignal): Promise<string[]> {
    const client = await this.connect();
    const { tools } = await this.request(() =>
      client.listTools(undefined, this.requestOptions(signal)),
    );
    return tools.map((tool) => tool.name);
  }

  async callTool<T extends McpToolName>(
    patientId: string,
    name: T,
    args: McpToolArgs<T>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    const client = await this.connect();
    // `patient_id` goes last so nothing in `args` can override it.
    const result = (await this.request(() =>
      client.callTool(
        { name, arguments: { ...args, patient_id: patientId } },
        undefined,
        this.requestOptions(signal),
      ),
    )) as CallToolResult;
    return { output: toOutput(result), isError: result.isError === true };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await (await client?.catch(() => undefined))?.close();
  }

  private requestOptions(signal: AbortSignal | undefined) {
    return { timeout: this.timeoutMs, ...(signal && { signal }) };
  }

  private connect(): Promise<Client> {
    const { url, authToken } = this.options;
    if (!authToken) return Promise.reject(new McpUnavailableError("MCP_AUTH_TOKEN is not set"));

    this.client ??= (async () => {
      const client = new Client({ name: "health-mcp-api", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
      });
      // The SDK's optional callbacks are typed `?: () => void`, which `exactOptionalPropertyTypes` rejects.
      await client.connect(transport as Transport, { timeout: this.timeoutMs });
      return client;
    })().catch((cause: unknown) => {
      this.client = undefined;
      throw new McpUnavailableError(`Could not connect to the MCP server at ${url}`, { cause });
    });
    return this.client;
  }

  /** Wraps transport failures; an aborted request is rethrown unchanged. */
  private async request<R>(send: () => Promise<R>): Promise<R> {
    try {
      return await send();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") throw cause;
      throw new McpUnavailableError("MCP request failed", { cause });
    }
  }
}
