import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { DatabaseService } from "../database/database.service.js";
import { ALLOW_PATIENTS, ALLOW_TEMPORARY_PASSWORD } from "./access.decorator.js";
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
 * signed-in doctor's patients (see patient-scope.ts). A temporary password
 * and a patient account each need the route to allow them (access.decorator.ts).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const marked = (key: string) =>
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]) ??
      false;
    if (marked(IS_PUBLIC)) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    let scope: PatientScope = "all";
    if (this.auth.enabled) {
      const token = bearerToken(request.headers.authorization);
      const user = token && this.auth.verifySession(token);
      if (!user) throw new UnauthorizedException("Sign in to continue.");
      if (user.mustChangePassword && !marked(ALLOW_TEMPORARY_PASSWORD))
        throw new ForbiddenException("Choose a new password first.");
      if (user.role === "patient" && !marked(ALLOW_PATIENTS))
        throw new ForbiddenException("Patient accounts cannot use this yet.");
      request.sessionUser = user;
      scope = { ownerId: user.id };
    }
    request.patientScope = scope;
    checkPatientAccess(this.database.db, request, scope);
    return true;
  }
}
