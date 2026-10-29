import { NextResponse } from "next/server";

import { api } from "@/lib/api-client";
import { cookieOptions, LOGIN_PATH, LOGIN_STATE_COOKIE, webOrigin } from "@/lib/session";

/** How long the browser may stay on Google's page. */
const LOGIN_STATE_MAX_AGE = 10 * 60;

/** Starts a Google sign-in: keeps the api's state in a cookie and sends the browser to Google. */
export async function GET(): Promise<Response> {
  let started;
  try {
    started = await api.startSignIn();
  } catch (error) {
    console.error("Could not start the sign-in", error);
    return NextResponse.redirect(new URL(`${LOGIN_PATH}?error=unavailable`, webOrigin()));
  }
  const response = NextResponse.redirect(started.url);
  response.cookies.set(LOGIN_STATE_COOKIE, started.loginState, {
    ...cookieOptions("/auth"),
    maxAge: LOGIN_STATE_MAX_AGE,
  });
  return response;
}
