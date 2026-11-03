import {
  API_ROUTES,
  type ChangePasswordInput,
  ChangePasswordInputSchema,
  type LoginResponse,
} from "@health-mcp/shared";
import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { AllowPatients, AllowTemporaryPassword, CurrentUser } from "./access.decorator.js";
import { AuthService, type SessionUser } from "./auth.service.js";

/** Changing one's own password; needs a session (unlike the sign-in routes). */
@Controller()
export class PasswordController {
  constructor(private readonly auth: AuthService) {}

  @Post(API_ROUTES.authPassword)
  @HttpCode(HttpStatus.OK)
  @AllowPatients()
  @AllowTemporaryPassword()
  change(
    @CurrentUser() user: SessionUser | undefined,
    @Body({ schema: ChangePasswordInputSchema }) input: ChangePasswordInput,
  ): Promise<LoginResponse> {
    return this.auth.changePassword(user, input);
  }
}
