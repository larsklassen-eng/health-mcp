import { type HealthDb, patients } from "@health-mcp/db";
import { createParamDecorator, type ExecutionContext, NotFoundException } from "@nestjs/common";
import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Request } from "express";

import type { SessionUser } from "./auth.service.js";

/**
 * Which patients a request may reach: those of the signed-in doctor, a
 * patient's own record (on the few routes open to patients, see
 * access.decorator.ts), or everyone's when sign-in is off (`yarn dev`,
 * tests). AuthGuard sets it on every route that needs a session.
 */
export type PatientScope = { readonly ownerId: string } | { readonly patientId: string } | "all";

export type ScopedRequest = Request & {
  patientScope?: PatientScope;
  /** The signed-in user (set by AuthGuard); undefined with sign-in off. */
  sessionUser?: SessionUser;
};

/** The request's {@link PatientScope}, as a controller parameter. */
export const Scope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PatientScope => {
    const scope = context.switchToHttp().getRequest<ScopedRequest>().patientScope;
    // Public routes have no scope, and must not ask for one.
    if (!scope) throw new Error("This route has no patient scope; is it public?");
    return scope;
  },
);

/** Condition on `patients` for the scope; undefined (no condition) for everyone's. */
export function ownedBy(scope: PatientScope): SQL | undefined {
  if (scope === "all") return undefined;
  return "patientId" in scope
    ? eq(patients.id, scope.patientId)
    : eq(patients.ownerId, scope.ownerId);
}

/** Condition on a `patient_id` column for the scope, for raw SQL. */
export function patientIdIn(scope: PatientScope): SQL {
  if (scope === "all") return sql`1 = 1`;
  return "patientId" in scope
    ? sql`patient_id = ${scope.patientId}`
    : sql`patient_id in (select id from ${patients} where owner_id = ${scope.ownerId})`;
}

/** The owner of patients created in the scope. Patients create none. */
export function ownerFor(scope: PatientScope): string | null {
  if (scope === "all") return null;
  if ("patientId" in scope) throw new Error("Patient accounts cannot create patients.");
  return scope.ownerId;
}

/** Routes about one patient: `/patients/:id...` and `/dashboards/patients/:id`. */
const PATIENT_ROUTE = /\/patients\/:id(\/|$)/;

/**
 * On a route about one patient, answers 404 unless the patient is in the
 * scope, as if it did not exist. Routes below the patient (chat, imaging)
 * look their records up through it, so this covers them too.
 */
export function checkPatientAccess(db: HealthDb, request: Request, scope: PatientScope): void {
  const path = (request.route as { path?: unknown } | undefined)?.path;
  if (scope === "all" || typeof path !== "string" || !PATIENT_ROUTE.test(path)) return;
  const { id } = request.params;
  if (typeof id !== "string") throw new NotFoundException("Patient not found");
  const patient = db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, id), ownedBy(scope)))
    .get();
  if (!patient) throw new NotFoundException(`Patient ${id} not found`);
}
