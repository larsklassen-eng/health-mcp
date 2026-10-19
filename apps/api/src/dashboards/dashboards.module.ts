import { Module } from "@nestjs/common";

import { ImagingModule } from "../imaging/imaging.module.js";
import { DashboardsController } from "./dashboards.controller.js";
import { DashboardsService } from "./dashboards.service.js";

@Module({
  imports: [ImagingModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
