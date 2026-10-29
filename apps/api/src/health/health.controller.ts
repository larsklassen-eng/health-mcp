import { API_ROUTES, type HealthCheckResponse } from "@health-mcp/shared";
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

import { Public } from "../auth/public.decorator.js";
import { DatabaseService } from "../database/database.service.js";

@Public()
@Controller()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get(API_ROUTES.health)
  check(): HealthCheckResponse {
    try {
      this.database.ping();
    } catch {
      throw new ServiceUnavailableException("Database is not reachable");
    }
    return { status: "ok", service: "api", timestamp: new Date().toISOString() };
  }
}
