import { type DashboardOverview, IdSchema, type PatientDashboard } from "@health-mcp/shared";
import { Controller, Get, Param } from "@nestjs/common";

import { type PatientScope, Scope } from "../auth/patient-scope.js";
import { DashboardsService } from "./dashboards.service.js";

/** Paths match `API_ROUTES.dashboardOverview` and `API_ROUTES.patientDashboard`. */
@Controller("dashboards")
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get("overview")
  overview(@Scope() scope: PatientScope): DashboardOverview {
    return this.dashboards.overview(scope);
  }

  @Get("patients/:id")
  patient(@Param("id", { schema: IdSchema }) id: string): PatientDashboard {
    return this.dashboards.patient(id);
  }
}
