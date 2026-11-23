import {
  MCP_TOOLS,
  type McpToolArgs,
  McpToolNameSchema,
  type RecordChange,
  RecordChangesOutputSchema,
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
import { IndexingService } from "../rag/indexing.service.js";
import { ChatHistoryService } from "./chat-history.service.js";

/**
 * The first field whose old value is no longer what the clinician was shown,
 * e.g. "dosage is now 8 mg, not 4 mg"; undefined when the preview still holds.
 * New values are not compared: a note's date may move on by a day.
 */
export function stalePreview(
  shown: readonly RecordChange[],
  now: readonly RecordChange[],
): string | undefined {
  const value = (change: RecordChange) => change.before ?? "empty";
  for (const was of shown) {
    const is = now.find((change) => change.field === was.field);
    if (!is) return `${was.field} no longer changes`;
    if (value(is) !== value(was)) return `${was.field} is now ${value(is)}, not ${value(was)}`;
  }
  const added = now.find((change) => !shown.some((was) => was.field === change.field));
  return added && `${added.field} would now change too`;
}

/**
 * Carries out the clinician's decision on a tool call that changes data (e.g.
 * `log_symptom`). The model only proposes such a call; it runs here, once,
 * after the clinician confirms it, and only if the record still matches what
 * the clinician was shown.
 */
@Injectable()
export class ToolCallDecisionService {
  private readonly logger = new Logger(ToolCallDecisionService.name);
  /** Calls being confirmed right now, so a double click cannot save twice. */
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly history: ChatHistoryService,
    private readonly mcp: McpClient,
    private readonly indexing: IndexingService,
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
      // Entries proposed before previews existed have none to check.
      if (call.preview) {
        const changed = stalePreview(call.preview, await this.preview(patientId, call));
        if (changed)
          throw new ConflictException(
            `The record changed since this was proposed (${changed}). Nothing was saved; ` +
              "discard it and ask again.",
          );
      }
      const output = await this.run(patientId, call);
      const saved = this.save(
        { ...call, output, isError: false, confirmation: "confirmed" },
        patientId,
      );
      // The MCP server saved a record (e.g. a symptom); make it searchable.
      await this.indexing.syncPatient(patientId);
      return saved;
    } finally {
      this.inProgress.delete(call.id);
    }
  }

  /** What the call would change now, saving nothing. */
  private async preview(patientId: string, call: ToolCall): Promise<RecordChange[]> {
    const output = await this.run(patientId, call, true);
    const parsed = RecordChangesOutputSchema.safeParse(output);
    if (!parsed.success) throw new BadGatewayException("Nothing was saved: no preview came back.");
    return parsed.data.changes;
  }

  private async run(patientId: string, call: ToolCall, dryRun = false): Promise<unknown> {
    const name = McpToolNameSchema.parse(call.name);
    // The input was validated when the model proposed it; check again before writing.
    const args = MCP_TOOLS[name].args.parse(call.input) as McpToolArgs<typeof name>;

    let result;
    try {
      result = await this.mcp.callTool(patientId, name, args, dryRun ? { dryRun } : {});
    } catch (error) {
      this.logger.error(`Confirmed ${name} could not be called`, error);
      throw new ServiceUnavailableException("The MCP server is not reachable. Nothing was saved.");
    }
    if (result.isError) {
      this.logger.warn(`Confirmed ${name} returned an error${dryRun ? " (dry run)" : ""}`);
      throw new BadGatewayException(`Nothing was saved: ${String(result.output)}`);
    }
    if (!dryRun) this.logger.log(`Confirmed ${name} for patient ${patientId}`);
    return result.output;
  }

  private save(call: ToolCall, patientId: string): ToolCall {
    this.history.updateToolCall(patientId, call);
    return call;
  }
}
