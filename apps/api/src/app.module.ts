import { Module } from "@nestjs/common";

import { ChatModule } from "./chat/chat.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { PatientsModule } from "./patients/patients.module.js";

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, PatientsModule, ChatModule],
})
export class AppModule {}
