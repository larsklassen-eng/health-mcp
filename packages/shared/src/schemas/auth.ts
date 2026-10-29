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

export const AuthUserSchema = z.object({
  email: z.email(),
  name: z.string().optional(),
});

/** Passwords: at least 12 characters (set with the api's users command). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** `POST /auth/login`. Any password length is accepted here, so the check reveals nothing. */
export const LoginInputSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
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
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
