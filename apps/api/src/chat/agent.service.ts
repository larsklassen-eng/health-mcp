import { randomUUID } from "node:crypto";

import { IdSchema, MCP_TOOLS, type McpToolArgs, type McpToolName, McpToolNameSchema } from "@health-mcp/shared";
import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";

import { LlmClient, type LlmMessage, type LlmToolCall, type LlmToolDefinition } from "../llm/llm-client.js";
import { McpClient, type McpToolResult } from "../mcp/mcp-client.js";

/** Most rounds of tool calls in one answer; a model still asking for tools after that is stopped. */
export const MAX_TOOL_ROUNDS = 8;

/** Stop reason reported when {@link MAX_TOOL_ROUNDS} is reached. */
export const TOOL_LIMIT_STOP_REASON = "max_tool_rounds";

/** What the agent does while answering, in order. Ends with exactly one `finish`. */
export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_call_result"; id: string; output: unknown; isError: boolean }
  | { type: "finish"; reason: string };

/** Tool definition sent to the model: the shared description and the JSON Schema of the model's arguments (no `patient_id`). */
export function toolDefinition(name: McpToolName): LlmToolDefinition {
  const { $schema: _, ...parameters } = z.toJSONSchema(MCP_TOOLS[name].args, { io: "input" });
  return { name, description: MCP_TOOLS[name].description, parameters };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toolError = (message: string): McpToolResult => ({ output: message, isError: true });

/** Tool result as the model sees it. */
const toolMessageContent = ({ output, isError }: McpToolResult) => {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return isError ? `Error: ${text}` : text;
};

/**
 * Runs the tool loop for one answer: the model either answers or asks for
 * tools; the tools run through apps/mcp-server and their results go back to
 * the model, until it answers. The api decides which patient every tool reads.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly mcp: McpClient,
  ) {}

  /**
   * Tools the model may use: those in the shared contract that the MCP server
   * offers. If the server is not configured or not reachable, chat goes on without tools.
   */
  async availableTools(signal?: AbortSignal): Promise<McpToolName[]> {
    try {
      const offered = new Set(await this.mcp.listToolNames(signal));
      return McpToolNameSchema.options.filter((name) => offered.has(name));
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn(`Answering without tools: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /** Streams one answer for `patientId`. Throws `LlmError` if the model fails. */
  async *run(patientId: string, messages: LlmMessage[], signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const tools = await this.availableTools(signal);
    const definitions = tools.map(toolDefinition);
    const conversation = [...messages];
    let wroteText = false;

    for (let round = 1; ; round++) {
      let text = "";
      let reason = "stop";
      const calls: LlmToolCall[] = [];

      for await (const event of this.llm.stream({ messages: conversation, ...(definitions.length > 0 && { tools: definitions }) }, signal)) {
        if (event.type === "text_delta") {
          // Text from different rounds ("Let me check…", then the answer) reads as separate paragraphs.
          if (!text && wroteText) yield { type: "text_delta", delta: "\n\n" };
          text += event.delta;
          wroteText = true;
          yield event;
        } else if (event.type === "tool_call") {
          calls.push(event.call);
        } else {
          reason = event.reason;
        }
      }

      if (calls.length === 0) {
        yield { type: "finish", reason };
        return;
      }
      if (round > MAX_TOOL_ROUNDS) {
        this.logger.warn(`Stopped after ${MAX_TOOL_ROUNDS} tool rounds for patient ${patientId}`);
        yield { type: "finish", reason: TOOL_LIMIT_STOP_REASON };
        return;
      }

      conversation.push({ role: "assistant", content: text, toolCalls: calls });
      for (const call of calls) {
        // Provider ids go back to the model unchanged; events and history need a valid, non-empty id.
        const id = IdSchema.safeParse(call.id).success ? call.id : randomUUID();
        const prepared = this.prepare(call.name, call.arguments, tools);
        // The input shown and saved is what the tool actually received; `patient_id` is never part of it.
        yield { type: "tool_call_start", id, name: call.name, input: prepared.input };

        const result = "error" in prepared ? toolError(prepared.error) : await this.callTool(patientId, prepared.tool, prepared.input, signal);
        yield { type: "tool_call_result", id, ...result };
        conversation.push({ role: "tool", toolCallId: call.id, content: toolMessageContent(result) });
      }
    }
  }

  /**
   * Checks the model's tool call against the offered tools and the shared
   * argument schema. Returns the validated arguments (defaults applied), or an
   * error for the model together with the raw arguments for display.
   */
  private prepare(
    name: string,
    json: string,
    tools: McpToolName[],
  ): { tool: McpToolName; input: Record<string, unknown> } | { error: string; input: Record<string, unknown> } {
    let raw: unknown;
    try {
      raw = JSON.parse(json.trim() || "{}");
    } catch {
      return { error: "The arguments must be a JSON object.", input: {} };
    }
    if (!isRecord(raw)) return { error: "The arguments must be a JSON object.", input: {} };
    const { patient_id: _, ...shown } = raw;

    const tool = tools.find((available) => available === name);
    if (!tool) return { error: `Unknown tool "${name}". Use only the tools provided.`, input: shown };

    // Strips unknown keys, so a `patient_id` chosen by the model is dropped here.
    const args = MCP_TOOLS[tool].args.safeParse(raw);
    if (!args.success) return { error: `Invalid arguments:\n${z.prettifyError(args.error)}`, input: shown };
    return { tool, input: args.data };
  }

  private async callTool(
    patientId: string,
    tool: McpToolName,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<McpToolResult> {
    const started = performance.now();
    try {
      // `args` was validated against this tool's schema in `prepare`.
      const result = await this.mcp.callTool(patientId, tool, args as McpToolArgs<typeof tool>, signal);
      this.logger.log(`Tool ${tool} ${result.isError ? "returned an error" : "succeeded"} in ${Math.round(performance.now() - started)} ms`);
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.error(`Tool ${tool} could not be called`, error);
      return toolError("The tool is unavailable right now.");
    }
  }
}
