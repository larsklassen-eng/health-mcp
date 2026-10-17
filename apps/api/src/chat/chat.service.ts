import { randomUUID } from "node:crypto";

import type { ChatMessage, ChatStreamEvent, ToolCall } from "@health-mcp/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { LlmClient, type LlmMessage } from "../llm/llm-client.js";
import { PatientsService } from "../patients/patients.service.js";
import { AgentService } from "./agent.service.js";
import { ChatHistoryService } from "./chat-history.service.js";
import { recentHistory } from "./history-window.js";
import { buildSystemPrompt } from "./system-prompt.js";

const toLlmMessage = ({ role, content }: ChatMessage): LlmMessage => ({ role, content });

/** Added to the system prompt when older messages were left out. */
export const OMITTED_HISTORY_NOTE =
  "Older messages of this chat were left out to keep the request small. " +
  "If the user refers to something you cannot see, say so and ask them to repeat it.";

/**
 * Runs one chat turn for a patient: saves the question, streams the agent's
 * answer, saves the answer. Only the text of recent messages is sent back to
 * the model (see `CHAT_HISTORY_MAX_CHARS`); tool results are not replayed,
 * which keeps requests small. The model calls the tools again when it needs the data.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly patients: PatientsService,
    private readonly history: ChatHistoryService,
    private readonly agent: AgentService,
    private readonly llm: LlmClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Throws 404 synchronously (before any event) if the patient does not exist,
   * so callers can still return a normal JSON error. After that, failures are
   * reported as an `error` event and the partial answer is not saved.
   */
  sendMessage(
    patientId: string,
    message: string,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const patient = this.patients.get(patientId);
    const previous = recentHistory(this.history.list(patientId), this.env.CHAT_HISTORY_MAX_CHARS);
    this.history.append(patientId, { role: "user", content: message });

    let system = buildSystemPrompt(patient, new Date().toISOString().slice(0, 10));
    if (previous.omitted > 0) {
      system += `\n\n${OMITTED_HISTORY_NOTE}`;
      this.logger.log(`Left out ${previous.omitted} older messages for patient ${patientId}`);
    }

    const messages: LlmMessage[] = [
      { role: "system", content: system },
      ...previous.messages.map(toLlmMessage),
      { role: "user", content: message },
    ];
    return this.streamAnswer(patientId, messages, signal);
  }

  private async *streamAnswer(
    patientId: string,
    messages: LlmMessage[],
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const messageId = randomUUID();
    yield { type: "message_start", messageId };

    let answer = "";
    let stopReason: string | undefined;
    const toolCalls: ToolCall[] = [];
    try {
      for await (const event of this.agent.run(patientId, messages, signal)) {
        switch (event.type) {
          case "text_delta":
            answer += event.delta;
            yield event;
            break;
          case "tool_call_start":
            toolCalls.push({ id: event.id, name: event.name, input: event.input, isError: false });
            yield {
              type: "tool_call_start",
              toolCallId: event.id,
              name: event.name,
              input: event.input,
            };
            break;
          case "tool_call_result": {
            const call = toolCalls.find((c) => c.id === event.id);
            if (call) Object.assign(call, { output: event.output, isError: event.isError });
            yield {
              type: "tool_call_result",
              toolCallId: event.id,
              output: event.output,
              isError: event.isError,
            };
            break;
          }
          case "finish":
            stopReason = event.reason;
        }
      }
    } catch (error) {
      if (signal.aborted) return; // client went away; nothing to report or save
      this.logger.error(
        `Chat turn failed for patient ${patientId} (model ${this.llm.model})`,
        error,
      );
      yield { type: "error", message: "The assistant could not answer. Please try again." };
      return;
    }

    this.history.append(patientId, {
      id: messageId,
      role: "assistant",
      content: answer,
      toolCalls,
    });
    yield { type: "message_end", messageId, ...(stopReason && { stopReason }) };
  }
}
