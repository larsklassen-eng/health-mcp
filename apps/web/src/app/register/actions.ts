"use server";

import { RegisterInputSchema } from "@health-mcp/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";
import { cookieOptions, SESSION_COOKIE } from "@/lib/session";

export interface RegisterState {
  error?: string;
  /** Kept so the form does not lose them after an error (passwords are not). */
  firstName?: string;
  lastName?: string;
  email?: string;
}

/** The api's own answers, shown as they are: they say what to fix. */
const SHOWN_STATUSES = new Set([400, 403, 409, 429]);

/**
 * Creates the doctor's account with the api, keeps the session in an
 * HTTP-only cookie and opens their (empty) patients list. The api checks the
 * password rules again; the form only shows them.
 */
export async function register(_previous: RegisterState, form: FormData): Promise<RegisterState> {
  const fields = {
    firstName: String(form.get("firstName") ?? ""),
    lastName: String(form.get("lastName") ?? ""),
    email: String(form.get("email") ?? ""),
  };
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("repeatPassword") ?? ""))
    return { ...fields, error: "The passwords do not match." };
  const parsed = RegisterInputSchema.safeParse({ ...fields, password });
  if (!parsed.success) return { ...fields, error: "Check the fields: some are too long." };

  let signedUp;
  try {
    signedUp = await api.register(parsed.data);
  } catch (error) {
    if (error instanceof ApiRequestError && SHOWN_STATUSES.has(error.status))
      return { ...fields, error: error.message };
    if (!(error instanceof ApiUnavailableError)) console.error("Sign-up failed", error);
    return { ...fields, error: "Sign-up is not available right now. Try again later." };
  }

  (await cookies()).set(SESSION_COOKIE, signedUp.session, {
    ...cookieOptions(),
    expires: new Date(signedUp.expiresAt),
  });
  redirect("/patients");
}
