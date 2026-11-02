import {
  API_ROUTES,
  type AuthSessionResponse,
  type LoginInput,
  LoginInputSchema,
  type LoginResponse,
  type RegisterInput,
  RegisterInputSchema,
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
import { AuthService, toAuthUser } from "./auth.service.js";
import { Public } from "./public.decorator.js";

/** Sign-in and sign-up endpoints, used by apps/web's login and register pages and its proxy. */
@Public()
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post(API_ROUTES.authLogin)
  @HttpCode(HttpStatus.OK)
  login(@Body({ schema: LoginInputSchema }) input: LoginInput): Promise<LoginResponse> {
    return this.auth.login(input);
  }

  @Post(API_ROUTES.authRegister)
  register(@Body({ schema: RegisterInputSchema }) input: RegisterInput): Promise<LoginResponse> {
    return this.auth.register(input);
  }

  @Get(API_ROUTES.authSession)
  session(@Headers("authorization") authorization?: string): AuthSessionResponse {
    if (!this.auth.enabled) return { mode: "off", user: null };
    const token = bearerToken(authorization);
    const user = token && this.auth.verifySession(token);
    if (!user) throw new UnauthorizedException("Sign in to continue.");
    return { mode: "password", user: toAuthUser(user) };
  }
}
