import {
  API_ROUTES,
  type AuthSessionResponse,
  type LoginInput,
  LoginInputSchema,
  type LoginResponse,
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

/** Sign-in endpoints, used by apps/web's login page and proxy. */
@Public()
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post(API_ROUTES.authLogin)
  @HttpCode(HttpStatus.OK)
  login(@Body({ schema: LoginInputSchema }) input: LoginInput): Promise<LoginResponse> {
    return this.auth.login(input);
  }

  @Get(API_ROUTES.authSession)
  session(@Headers("authorization") authorization?: string): AuthSessionResponse {
    if (!this.auth.enabled) return { mode: "off", user: null };
    const token = bearerToken(authorization);
    const user = token && this.auth.verifySession(token);
    if (!user) throw new UnauthorizedException("Sign in to continue.");
    return { mode: "password", user };
  }
}
