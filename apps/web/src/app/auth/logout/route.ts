import { NextResponse } from "next/server";

import { LOGIN_PATH, SESSION_COOKIE, webOrigin } from "@/lib/session";

/**
 * Signs out by deleting the session cookie. Sessions are not stored anywhere,
 * so a copied token stays valid until it expires (SESSION_TTL_HOURS) or the
 * address leaves the allowlist.
 */
export function POST(): Response {
  // 303: the browser follows a form POST with a GET.
  const response = NextResponse.redirect(new URL(`${LOGIN_PATH}?signed-out`, webOrigin()), 303);
  response.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return response;
}
