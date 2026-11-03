import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { DatabaseService } from "../database/database.service.js";
import { AuthService } from "./auth.service.js";
import { checkPatientAccess, type PatientScope, type ScopedRequest } from "./patient-scope.js";
import { IS_PUBLIC } from "./public.decorator.js";

/** The session token from `Authorization: Bearer <token>`. */
export function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer (\S+)$/.exec(header ?? "")?.[1];
}

/**
 * Applied to every route (see AuthModule). With sign-in on, a route needs a
 * valid session unless it is marked `@Public()`, and reaches only the
 * signed-in doctor's patients (see patient-scope.ts).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    let scope: PatientScope = "all";
    if (this.auth.enabled) {
      const token = bearerToken(request.headers.authorization);
      const user = token && this.auth.verifySession(token);
      if (!user) throw new UnauthorizedException("Sign in to continue.");
      // Patients reach nothing yet: what they may read is decided route by route (next step).
      if (user.role === "patient")
        throw new ForbiddenException("Patient accounts cannot use this yet.");
      scope = { ownerId: user.id };
    }
    request.patientScope = scope;
    checkPatientAccess(this.database.db, request, scope);
    return true;
  }
}
