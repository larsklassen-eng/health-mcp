import {
  API_ROUTES,
  type ChatHistoryResponse,
  IdSchema,
  type SendChatMessageRequest,
  SendChatMessageRequestSchema,
  type ToolCall,
  type ToolCallDecisionRequest,
  ToolCallDecisionRequestSchema,
} from "@health-mcp/shared";
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";

import { ChatHistoryService } from "./chat-history.service.js";
import { ChatService } from "./chat.service.js";
import { ToolCallDecisionService } from "./tool-call-decision.service.js";

const idParam = { schema: IdSchema };

/** Routes under `/patients/:id/chat`. Each patient has exactly one chat. */
@Controller(API_ROUTES.patients)
export class ChatController {
  constructor(
    private readonly history: ChatHistoryService,
    private readonly chat: ChatService,
    private readonly decisions: ToolCallDecisionService,
  ) {}

  /**
   * Confirms or discards a tool call that waits for the clinician (e.g. a
   * symptom to log). Confirming runs the tool; returns the updated tool call.
   */
  @Post(":id/chat/tool-calls/:toolCallId/decision")
  @HttpCode(HttpStatus.OK)
  decide(
    @Param("id", idParam) patientId: string,
    @Param("toolCallId", idParam) toolCallId: string,
    @Body({ schema: ToolCallDecisionRequestSchema }) body: ToolCallDecisionRequest,
  ): Promise<ToolCall> {
    return this.decisions.decide(patientId, toolCallId, body);
  }

  @Get(":id/chat")
  getHistory(@Param("id", idParam) patientId: string): ChatHistoryResponse {
    return { messages: this.history.list(patientId) };
  }

  /**
   * Sends a message and streams the answer as server-sent events, one
   * `ChatStreamEvent` (JSON) per `data:` line. Validation and unknown-patient
   * errors are returned as normal JSON before the stream starts.
   */
  @Post(":id/chat")
  async send(
    @Param("id", idParam) patientId: string,
    @Body({ schema: SendChatMessageRequestSchema }) body: SendChatMessageRequest,
    @Res() res: Response,
  ): Promise<void> {
    const abort = new AbortController();
    const events = this.chat.sendMessage(patientId, body.message, abort.signal);

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // stop reverse proxies from buffering the stream
    });
    res.flushHeaders();
    // Stop the model (and stop paying for tokens) if the client disconnects mid-answer.
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    for await (const event of events) {
      if (abort.signal.aborted) break;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }
}
