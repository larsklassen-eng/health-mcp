import type { McpToolArgs, McpToolName } from "@health-mcp/shared";

/**
 * Outcome of one tool call. `isError` results are still passed to the model,
 * which can react to them.
 */
export interface McpToolResult {
  /** Parsed JSON when the tool returned JSON text, otherwise the text itself. */
  output: unknown;
  isError: boolean;
}

/**
 * Injection token and base class for calling apps/mcp-server. Implementations
 * add `patient_id` to every call themselves; it is never taken from the model.
 */
export abstract class McpClient {
  /** Names of the tools the server offers. Throws if the server cannot be reached. */
  abstract listToolNames(signal?: AbortSignal): Promise<string[]>;

  /**
   * Calls `name` for `patientId`. Throws if the server cannot be reached;
   * tool failures come back as `isError`.
   */
  abstract callTool<T extends McpToolName>(
    patientId: string,
    name: T,
    args: McpToolArgs<T>,
    signal?: AbortSignal,
  ): Promise<McpToolResult>;
}
