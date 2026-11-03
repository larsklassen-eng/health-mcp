import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";

import type { SessionUser } from "./auth.service.js";
import type { ScopedRequest } from "./patient-scope.js";

/*
 * Which signed-in users may use a route, besides doctors who have chosen
 * their own password (who may use every route that needs a session). Both
 * are opt-in, so a new route is closed to patients and to temporary
 * passwords until it is marked.
 */

export const ALLOW_PATIENTS = "auth:allow-patients";
export const ALLOW_TEMPORARY_PASSWORD = "auth:allow-temporary-password";

/** Patient accounts may use this route (their own record only; see patient-scope.ts). */
export const AllowPatients = () => SetMetadata(ALLOW_PATIENTS, true);

/** Usable before a temporary password is replaced (changing it, for one). */
export const AllowTemporaryPassword = () => SetMetadata(ALLOW_TEMPORARY_PASSWORD, true);

/** The signed-in user, as a controller parameter; undefined with sign-in off. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | undefined =>
    context.switchToHttp().getRequest<ScopedRequest>().sessionUser,
);
