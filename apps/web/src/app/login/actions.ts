"use server";

import { LoginInputSchema } from "@health-mcp/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";
import { cookieOptions, RETURN_TO_COOKIE, safeReturnPath, SESSION_COOKIE } from "@/lib/session";

export interface SignInState {
  error?: string;
  /** Kept so the form does not lose it after an error. */
  email?: string;
}

/**
 * Signs in with the api; on success keeps the session in an HTTP-only cookie
 * and returns to the page the user wanted.
 */
export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "");
  const parsed = LoginInputSchema.safeParse({ email, password: form.get("password") });
  if (!parsed.success) return { email, error: "Enter your email and password." };

  let signedIn;
  try {
    signedIn = await api.login(parsed.data);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 429))
      return { email, error: error.message };
    if (!(error instanceof ApiUnavailableError)) console.error("Sign-in failed", error);
    return { email, error: "Sign-in is not available right now. Try again later." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, signedIn.session, {
    ...cookieOptions(),
    expires: new Date(signedIn.expiresAt),
  });
  const returnTo = safeReturnPath(store.get(RETURN_TO_COOKIE)?.value);
  store.delete(RETURN_TO_COOKIE);
  redirect(returnTo);
}
