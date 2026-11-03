import { Module } from "@nestjs/common";

import { PatientAccountController } from "./patient-account.controller.js";
import { PatientAccountService } from "./patient-account.service.js";
import { PatientImportService } from "./patient-import.service.js";
import { PatientsController } from "./patients.controller.js";
import { PatientsService } from "./patients.service.js";

@Module({
  controllers: [PatientsController, PatientAccountController],
  providers: [PatientsService, PatientImportService, PatientAccountService],
  exports: [PatientsService],
})
export class PatientsModule {}
