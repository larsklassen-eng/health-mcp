import { Module } from "@nestjs/common";

import { ChatModule } from "./chat/chat.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DashboardsModule } from "./dashboards/dashboards.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { ImagingModule } from "./imaging/imaging.module.js";
import { LlmModule } from "./llm/llm.module.js";
import { McpModule } from "./mcp/mcp.module.js";
import { PatientsModule } from "./patients/patients.module.js";
import { RagModule } from "./rag/rag.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RagModule,
    LlmModule,
    McpModule,
    HealthModule,
    PatientsModule,
    ChatModule,
    DashboardsModule,
    ImagingModule,
  ],
})
export class AppModule {}
