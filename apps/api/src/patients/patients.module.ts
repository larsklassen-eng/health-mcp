import { Module } from "@nestjs/common";

import { PatientImportService } from "./patient-import.service.js";
import { PatientsController } from "./patients.controller.js";
import { PatientsService } from "./patients.service.js";

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientImportService],
  exports: [PatientsService],
})
export class PatientsModule {}
