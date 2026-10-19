import {
  MCP_TOOLS,
  type McpToolArgs,
  McpToolNameSchema,
  type ToolCall,
  type ToolCallDecisionRequest,
} from "@health-mcp/shared";
import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { McpClient } from "../mcp/mcp-client.js";
import { ChatHistoryService } from "./chat-history.service.js";

/**
 * Carries out the clinician's decision on a tool call that changes data (e.g.
 * `log_symptom`). The model only proposes such a call; it runs here, once,
 * after the clinician confirms it.
 */
@Injectable()
export class ToolCallDecisionService {
  private readonly logger = new Logger(ToolCallDecisionService.name);
  /** Calls being confirmed right now, so a double click cannot save twice. */
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly history: ChatHistoryService,
    private readonly mcp: McpClient,
  ) {}

  async decide(
    patientId: string,
    toolCallId: string,
    { decision }: ToolCallDecisionRequest,
  ): Promise<ToolCall> {
    const call = this.history.findToolCall(patientId, toolCallId);
    if (!call) throw new NotFoundException(`Tool call ${toolCallId} not found`);
    if (call.confirmation !== "pending" || this.inProgress.has(call.id))
      throw new ConflictException("This entry was already saved or discarded");

    if (decision === "reject") return this.save({ ...call, confirmation: "rejected" }, patientId);

    this.inProgress.add(call.id);
    try {
      const output = await this.run(patientId, call);
      return this.save({ ...call, output, isError: false, confirmation: "confirmed" }, patientId);
    } finally {
      this.inProgress.delete(call.id);
    }
  }

  private async run(patientId: string, call: ToolCall): Promise<unknown> {
    const name = McpToolNameSchema.parse(call.name);
    // The input was validated when the model proposed it; check again before writing.
    const args = MCP_TOOLS[name].args.parse(call.input) as McpToolArgs<typeof name>;

    let result;
    try {
      result = await this.mcp.callTool(patientId, name, args);
    } catch (error) {
      this.logger.error(`Confirmed ${name} could not be called`, error);
      throw new ServiceUnavailableException("The MCP server is not reachable. Nothing was saved.");
    }
    if (result.isError) {
      this.logger.warn(`Confirmed ${name} returned an error`);
      throw new BadGatewayException(`Nothing was saved: ${String(result.output)}`);
    }
    this.logger.log(`Confirmed ${name} for patient ${patientId}`);
    return result.output;
  }

  private save(call: ToolCall, patientId: string): ToolCall {
    this.history.updateToolCall(patientId, call);
    return call;
  }
}
