import { type HealthDb, patients } from "@health-mcp/db";
import { createParamDecorator, type ExecutionContext, NotFoundException } from "@nestjs/common";
import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Request } from "express";

/**
 * Which patients a request may reach: those of the signed-in doctor, or
 * everyone's when sign-in is off (`yarn dev`, tests). AuthGuard sets it on
 * every route that needs a session.
 */
export type PatientScope = { readonly ownerId: string } | "all";

export type ScopedRequest = Request & { patientScope?: PatientScope };

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
export const ownedBy = (scope: PatientScope): SQL | undefined =>
  scope === "all" ? undefined : eq(patients.ownerId, scope.ownerId);

/** Condition on a `patient_id` column for the scope, for raw SQL. */
export const patientIdIn = (scope: PatientScope): SQL =>
  scope === "all"
    ? sql`1 = 1`
    : sql`patient_id in (select id from ${patients} where owner_id = ${scope.ownerId})`;

/** The owner of patients created in the scope. */
export const ownerFor = (scope: PatientScope): string | null =>
  scope === "all" ? null : scope.ownerId;

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
