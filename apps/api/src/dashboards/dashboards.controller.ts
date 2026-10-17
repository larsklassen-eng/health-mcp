import { type DashboardOverview, IdSchema, type PatientDashboard } from "@health-mcp/shared";
import { Controller, Get, Param } from "@nestjs/common";

import { DashboardsService } from "./dashboards.service.js";

/** Paths match `API_ROUTES.dashboardOverview` and `API_ROUTES.patientDashboard`. */
@Controller("dashboards")
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get("overview")
  overview(): DashboardOverview {
    return this.dashboards.overview();
  }

  @Get("patients/:id")
  patient(@Param("id", { schema: IdSchema }) id: string): PatientDashboard {
    return this.dashboards.patient(id);
  }
}
