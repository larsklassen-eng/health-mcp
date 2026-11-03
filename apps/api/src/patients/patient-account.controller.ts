import {
  API_ROUTES,
  type CreatePatientAccountInput,
  CreatePatientAccountInputSchema,
  IdSchema,
  type PatientAccount,
  type PatientAccountResponse,
  type ResetPatientPasswordInput,
  ResetPatientPasswordInputSchema,
} from "@health-mcp/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from "@nestjs/common";

import { PatientAccountService } from "./patient-account.service.js";

const idParam = { schema: IdSchema };

/** Paths match `API_ROUTES.patientAccount` and `API_ROUTES.patientAccountPassword`. */
@Controller(API_ROUTES.patients)
export class PatientAccountController {
  constructor(private readonly accounts: PatientAccountService) {}

  @Get(":id/account")
  get(@Param("id", idParam) id: string): PatientAccountResponse {
    return { account: this.accounts.get(id) };
  }

  @Post(":id/account")
  create(
    @Param("id", idParam) id: string,
    @Body({ schema: CreatePatientAccountInputSchema }) input: CreatePatientAccountInput,
  ): Promise<PatientAccount> {
    return this.accounts.create(id, input);
  }

  @Put(":id/account/password")
  resetPassword(
    @Param("id", idParam) id: string,
    @Body({ schema: ResetPatientPasswordInputSchema }) input: ResetPatientPasswordInput,
  ): Promise<PatientAccount> {
    return this.accounts.resetPassword(id, input);
  }

  @Delete(":id/account")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", idParam) id: string): void {
    this.accounts.remove(id);
  }
}
