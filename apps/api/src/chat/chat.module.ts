import { Module } from "@nestjs/common";

import { PatientsModule } from "../patients/patients.module.js";
import { AgentService } from "./agent.service.js";
import { ChatHistoryService } from "./chat-history.service.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { ToolCallDecisionService } from "./tool-call-decision.service.js";

@Module({
  imports: [PatientsModule],
  controllers: [ChatController],
  providers: [AgentService, ChatHistoryService, ChatService, ToolCallDecisionService],
})
export class ChatModule {}
