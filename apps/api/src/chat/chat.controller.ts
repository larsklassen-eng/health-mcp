import { API_ROUTES, type ChatHistoryResponse, IdSchema } from "@health-mcp/shared";
import { Controller, Get, Param } from "@nestjs/common";

import { ChatHistoryService } from "./chat-history.service.js";

/** Routes under `/patients/:id/chat`. Each patient has exactly one chat. */
@Controller(API_ROUTES.patients)
export class ChatController {
  constructor(private readonly history: ChatHistoryService) {}

  @Get(":id/chat")
  getHistory(@Param("id", { schema: IdSchema }) patientId: string): ChatHistoryResponse {
    return { messages: this.history.list(patientId) };
  }
}
