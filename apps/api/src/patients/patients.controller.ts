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

import { IndexingService } from "../rag/indexing.service.js";
import { PatientImportService } from "./patient-import.service.js";
import { PatientsService } from "./patients.service.js";

const idParam = { schema: IdSchema };

@Controller(API_ROUTES.patients)
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly importer: PatientImportService,
    private readonly indexing: IndexingService,
  ) {}

  @Get()
  list(): PatientListResponse {
    return { patients: this.patients.list() };
  }

  @Post()
  async create(
    @Body({ schema: CreatePatientInputSchema }) input: CreatePatientInput,
  ): Promise<Patient> {
    const patient = this.patients.create(input);
    await this.indexing.syncPatient(patient.id);
    return patient;
  }

  /**
   * `POST /patients/import`. The file format is `PatientImportFileSchema` in
   * @health-mcp/shared.
   */
  @Post("import")
  async import(
    @Body({ schema: PatientImportFileSchema }) file: ParsedPatientImportFile,
  ): Promise<PatientImportResult> {
    const result = this.importer.import(file);
    for (const { patientId } of result.imported) await this.indexing.syncPatient(patientId);
    return result;
  }

  @Get(":id")
  get(@Param("id", idParam) id: string): Patient {
    return this.patients.get(id);
  }

  @Patch(":id")
  async update(
    @Param("id", idParam) id: string,
    @Body({ schema: UpdatePatientInputSchema }) input: UpdatePatientInput,
  ): Promise<Patient> {
    const patient = this.patients.update(id, input);
    await this.indexing.syncPatient(id);
    return patient;
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", idParam) id: string): Promise<void> {
    await this.patients.remove(id);
  }
}
