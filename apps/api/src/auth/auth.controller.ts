import {
  API_ROUTES,
  type AuthCallbackInput,
  AuthCallbackInputSchema,
  type AuthCallbackResponse,
  type AuthSessionResponse,
  type AuthStartResponse,
} from "@health-mcp/shared";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from "@nestjs/common";

import { bearerToken } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { Public } from "./public.decorator.js";

/** Sign-in endpoints, used by apps/web's login routes. */
@Public()
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post(API_ROUTES.authGoogleStart)
  @HttpCode(HttpStatus.OK)
  start(): AuthStartResponse {
    return this.auth.start();
  }

  @Post(API_ROUTES.authGoogleCallback)
  @HttpCode(HttpStatus.OK)
  callback(
    @Body({ schema: AuthCallbackInputSchema }) input: AuthCallbackInput,
  ): Promise<AuthCallbackResponse> {
    return this.auth.finish(input);
  }

  @Get(API_ROUTES.authSession)
  session(@Headers("authorization") authorization?: string): AuthSessionResponse {
    if (!this.auth.enabled) return { mode: "off", user: null };
    const token = bearerToken(authorization);
    const user = token && this.auth.verifySession(token);
    if (!user) throw new UnauthorizedException("Sign in to continue.");
    return { mode: "google", user };
  }
}
