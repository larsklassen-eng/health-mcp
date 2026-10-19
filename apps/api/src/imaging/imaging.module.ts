import { Module } from "@nestjs/common";

import { PatientsModule } from "../patients/patients.module.js";
import { DicomImportService } from "./dicom-import.service.js";
import { ImagingController } from "./imaging.controller.js";
import { ImagingService } from "./imaging.service.js";

@Module({
  imports: [PatientsModule],
  controllers: [ImagingController],
  providers: [ImagingService, DicomImportService],
  exports: [ImagingService],
})
export class ImagingModule {}
