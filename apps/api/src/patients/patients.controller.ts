import {
  type CreatePatientInput,
  CreatePatientInputSchema,
  IdSchema,
  type ParsedPatientImportFile,
  type Patient,
  PatientImportFileSchema,
  type PatientImportResult,
  type PatientListResponse,
  API_ROUTES,
  type UpdatePatientInput,
  UpdatePatientInputSchema,
} from "@health-mcp/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import { PatientImportService } from "./patient-import.service.js";
import { PatientsService } from "./patients.service.js";

const idParam = { schema: IdSchema };

@Controller(API_ROUTES.patients)
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly importer: PatientImportService,
  ) {}

  @Get()
  list(): PatientListResponse {
    return { patients: this.patients.list() };
  }

  @Post()
  create(@Body({ schema: CreatePatientInputSchema }) input: CreatePatientInput): Patient {
    return this.patients.create(input);
  }

  /**
   * `POST /patients/import`. The file format is `PatientImportFileSchema` in
   * @health-mcp/shared.
   */
  @Post("import")
  import(
    @Body({ schema: PatientImportFileSchema }) file: ParsedPatientImportFile,
  ): PatientImportResult {
    return this.importer.import(file);
  }

  @Get(":id")
  get(@Param("id", idParam) id: string): Patient {
    return this.patients.get(id);
  }

  @Patch(":id")
  update(
    @Param("id", idParam) id: string,
    @Body({ schema: UpdatePatientInputSchema }) input: UpdatePatientInput,
  ): Patient {
    return this.patients.update(id, input);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", idParam) id: string): void {
    this.patients.remove(id);
  }
}
