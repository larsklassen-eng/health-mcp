import { randomUUID } from "node:crypto";

import type { ChatMessage, ChatStreamEvent } from "@health-mcp/shared";
import { Injectable, Logger } from "@nestjs/common";

import { LlmClient, LlmError, type LlmMessage } from "../llm/llm-client.js";
import { PatientsService } from "../patients/patients.service.js";
import { ChatHistoryService } from "./chat-history.service.js";
import { buildSystemPrompt } from "./system-prompt.js";

const toLlmMessage = ({ role, content }: ChatMessage): LlmMessage => ({ role, content });

/** Runs one chat turn for a patient: saves the question, streams the model's answer, saves the answer. */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly patients: PatientsService,
    private readonly history: ChatHistoryService,
    private readonly llm: LlmClient,
  ) {}

  /**
   * Throws 404 synchronously (before any event) if the patient does not exist,
   * so callers can still return a normal JSON error. After that, failures are
   * reported as an `error` event and the partial answer is not saved.
   */
  sendMessage(patientId: string, message: string, signal: AbortSignal): AsyncIterable<ChatStreamEvent> {
    const patient = this.patients.get(patientId);
    const previous = this.history.list(patientId);
    this.history.append(patientId, { role: "user", content: message });

    const messages: LlmMessage[] = [
      { role: "system", content: buildSystemPrompt(patient, new Date().toISOString().slice(0, 10)) },
      ...previous.map(toLlmMessage),
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
    try {
      for await (const event of this.llm.stream({ messages }, signal)) {
        if (event.type === "text_delta") {
          answer += event.delta;
          yield { type: "text_delta", delta: event.delta };
        } else if (event.type === "finish") {
          stopReason = event.reason;
        }
        // No tools are offered yet, so `tool_call` events are not expected and are ignored.
      }
    } catch (error) {
      if (error instanceof LlmError && error.aborted) return; // client went away; nothing to report or save
      this.logger.error(`Chat turn failed for patient ${patientId} (model ${this.llm.model})`, error);
      yield { type: "error", message: "The assistant could not answer. Please try again." };
      return;
    }

    this.history.append(patientId, { id: messageId, role: "assistant", content: answer });
    yield { type: "message_end", messageId, ...(stopReason && { stopReason }) };
  }
}
