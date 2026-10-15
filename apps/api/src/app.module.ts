import { Module } from "@nestjs/common";

import { ChatModule } from "./chat/chat.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { LlmModule } from "./llm/llm.module.js";
import { McpModule } from "./mcp/mcp.module.js";
import { PatientsModule } from "./patients/patients.module.js";

@Module({
  imports: [ConfigModule, DatabaseModule, LlmModule, McpModule, HealthModule, PatientsModule, ChatModule],
})
export class AppModule {}
