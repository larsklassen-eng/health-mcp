import { z } from "zod";

import { IsoDateTimeSchema } from "./common.js";

/**
 * Sign-in (Google) between apps/web and apps/api. The api does the OAuth work
 * and signs every token; apps/web only keeps them in HTTP-only cookies and
 * sends the session to the api as `Authorization: Bearer <session>`.
 */

/** `google`: every api route except health and sign-in needs a session. `off`: no sign-in. */
export const AuthModeSchema = z.enum(["google", "off"]);

export const AuthUserSchema = z.object({
  email: z.email(),
  name: z.string().optional(),
});

/** `POST /auth/google/start`: where to send the browser, and the state to keep until it returns. */
export const AuthStartResponseSchema = z.object({
  /** Google's sign-in page. */
  url: z.url(),
  /** Signed, short-lived; apps/web keeps it in a cookie and sends it back with the callback. */
  loginState: z.string().min(1),
});

/** `POST /auth/google/callback`: what Google returned to apps/web, plus the kept state. */
export const AuthCallbackInputSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
  loginState: z.string().min(1).max(4096),
});

export const AuthCallbackResponseSchema = z.object({
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
export type AuthStartResponse = z.infer<typeof AuthStartResponseSchema>;
export type AuthCallbackInput = z.infer<typeof AuthCallbackInputSchema>;
export type AuthCallbackResponse = z.infer<typeof AuthCallbackResponseSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
