import { Module } from "@nestjs/common";

import { PatientsModule } from "../patients/patients.module.js";
import { ChatHistoryService } from "./chat-history.service.js";
import { ChatController } from "./chat.controller.js";

@Module({
  imports: [PatientsModule],
  controllers: [ChatController],
  providers: [ChatHistoryService],
})
export class ChatModule {}
