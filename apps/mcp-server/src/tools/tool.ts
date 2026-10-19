import {
  MCP_TOOLS,
  mcpToolInputSchema,
  type McpToolInput,
  type McpToolName,
} from "@health-mcp/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * An expected failure (e.g. unknown patient). Its message is returned to the
 * model as the tool result.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolHandler<T extends McpToolName> = (input: McpToolInput<T>) => unknown;

const textResult = (text: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text }],
  ...(isError && { isError }),
});

/**
 * Registers a tool from the shared contract in `@health-mcp/shared`: its
 * description, and its input schema (the model's arguments plus `patient_id`).
 * The SDK validates the input before `handler` runs. The handler's return value
 * is sent as JSON text.
 */
export function registerTool<T extends McpToolName>(
  server: McpServer,
  name: T,
  handler: ToolHandler<T>,
): void {
  server.registerTool(
    name,
    { description: MCP_TOOLS[name].description, inputSchema: mcpToolInputSchema(name) },
    async (input: McpToolInput<T>): Promise<CallToolResult> => {
      try {
        return textResult(JSON.stringify(await handler(input)));
      } catch (error) {
        if (error instanceof ToolError) return textResult(error.message, true);
        console.error(`Tool ${name} failed`, error);
        return textResult(`The ${name} tool failed unexpectedly.`, true);
      }
    },
  );
}
