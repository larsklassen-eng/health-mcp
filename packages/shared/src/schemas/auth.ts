import { z } from "zod";

import { IsoDateTimeSchema } from "./common.js";

/**
 * Sign-in between apps/web and apps/api. Users sign in with an email address
 * and a password; the api checks them and signs a session token, which
 * apps/web keeps in an HTTP-only cookie and sends to the api as
 * `Authorization: Bearer <session>`.
 */

/** `password`: every api route except health and sign-in needs a session. `off`: no sign-in. */
export const AuthModeSchema = z.enum(["password", "off"]);

/**
 * `doctor`: sees the patients they own. `patient`: an account a doctor created
 * for one patient, who sees only their own record, read-only.
 */
export const UserRoleSchema = z.enum(["doctor", "patient"]);

export const AuthUserSchema = z.object({
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  role: UserRoleSchema,
  /** A patient's own record; only for `patient`. */
  patientId: z.string().optional(),
  /** Set for temporary passwords: nothing else works until the user picks their own. */
  mustChangePassword: z.boolean(),
});

/** First and last names: required for new users, at most this long. */
export const NAME_MAX_LENGTH = 100;

/** Password length bounds; the full rules are in `@health-mcp/shared/password`. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** `POST /auth/login`. Any password length is accepted here, so the check reveals nothing. */
export const LoginInputSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/**
 * `POST /auth/register`: a doctor creates their own account and is signed in
 * (the response is a {@link LoginResponseSchema}). Only types and upper bounds
 * are checked here; the api checks the rest (names given, a valid email that is
 * free, the password rules), so its messages can say what to fix.
 */
export const RegisterInputSchema = z.object({
  firstName: z.string().trim().max(NAME_MAX_LENGTH),
  lastName: z.string().trim().max(NAME_MAX_LENGTH),
  email: z.string().trim().max(320),
  password: z.string().max(PASSWORD_MAX_LENGTH),
});

export const LoginResponseSchema = z.object({
  /** Signed session token; apps/web keeps it in an HTTP-only cookie. */
  session: z.string().min(1),
  user: AuthUserSchema,
  expiresAt: IsoDateTimeSchema,
});

/** `GET /auth/session`: whether sign-in is on, and who the session belongs to. */
export const AuthSessionResponseSchema = z.object({
  mode: AuthModeSchema,
  /** Null when sign-in is off. */
  user: AuthUserSchema.nullable(),
});

export type AuthMode = z.infer<typeof AuthModeSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type RegisterInput = z.infer<typeof RegisterInputSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
