import { type NextRequest, NextResponse } from "next/server";

import { api, ApiRequestError } from "@/lib/api-client";
import {
  cookieOptions,
  LOGIN_PATH,
  LOGIN_STATE_COOKIE,
  RETURN_TO_COOKIE,
  safeReturnPath,
  SESSION_COOKIE,
  webOrigin,
} from "@/lib/session";

/** Why a sign-in failed, as shown on the login page (see `login/page.tsx`). */
export type SignInError = "cancelled" | "expired" | "not-allowed" | "failed" | "unavailable";

function reasonFor(error: unknown): SignInError {
  if (!(error instanceof ApiRequestError)) return "unavailable";
  if (error.status === 403) return "not-allowed";
  return error.status === 401 ? "failed" : "unavailable";
}

/**
 * Where Google sends the browser back. The api checks everything; on success
 * the session goes into an HTTP-only cookie and the user returns to the page
 * they wanted.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const loginState = request.cookies.get(LOGIN_STATE_COOKIE)?.value;

  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, webOrigin()));
    response.cookies.delete({ name: LOGIN_STATE_COOKIE, path: "/auth" });
    return response;
  };

  // Google adds `error` when the user cancels or the request is refused.
  if (params.has("error")) return finish(`${LOGIN_PATH}?error=cancelled`);
  if (!code || !state || !loginState) return finish(`${LOGIN_PATH}?error=expired`);

  let signedIn;
  try {
    signedIn = await api.finishSignIn({ code, state, loginState });
  } catch (error) {
    if (!(error instanceof ApiRequestError)) console.error("Could not finish the sign-in", error);
    return finish(`${LOGIN_PATH}?error=${reasonFor(error)}`);
  }

  const response = finish(safeReturnPath(request.cookies.get(RETURN_TO_COOKIE)?.value));
  response.cookies.set(SESSION_COOKIE, signedIn.session, {
    ...cookieOptions(),
    expires: new Date(signedIn.expiresAt),
  });
  response.cookies.delete({ name: RETURN_TO_COOKIE, path: "/" });
  return response;
}
