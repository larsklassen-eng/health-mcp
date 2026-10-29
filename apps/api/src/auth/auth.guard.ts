import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { AuthService } from "./auth.service.js";
import { IS_PUBLIC } from "./public.decorator.js";

/** The session token from `Authorization: Bearer <token>`. */
export function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer (\S+)$/.exec(header ?? "")?.[1];
}

/**
 * Applied to every route (see AuthModule). With sign-in on, a route needs a
 * valid session unless it is marked `@Public()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.auth.enabled) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request.headers.authorization);
    if (!token || !this.auth.verifySession(token))
      throw new UnauthorizedException("Sign in to continue.");
    return true;
  }
}
