import { type NextRequest, NextResponse } from "next/server";

import { api } from "@/lib/api-client";
import {
  cookieOptions,
  LOGIN_PATH,
  RETURN_TO_COOKIE,
  SESSION_COOKIE,
  webOrigin,
} from "@/lib/session";

/**
 * Runs before every page and route except sign-in and static files. When
 * sign-in is on and the request has no valid session, pages redirect to the
 * login page (remembering where the user was going) and other requests get
 * 401. The api checks the session again on every call, so this is the
 * friendly front door, not the only lock.
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let session;
  try {
    session = await api.getSession(token ?? null);
  } catch {
    // The api is down: let the page render and say so.
    return NextResponse.next();
  }
  if (session.mode === "off" || session.user) return NextResponse.next();

  const isPage =
    request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  const response = isPage
    ? NextResponse.redirect(new URL(LOGIN_PATH, webOrigin()))
    : NextResponse.json(
        { statusCode: 401, error: "Unauthorized", message: "Sign in to continue." },
        { status: 401 },
      );
  if (isPage) {
    const { pathname, search } = request.nextUrl;
    response.cookies.set(RETURN_TO_COOKIE, `${pathname}${search}`, {
      ...cookieOptions(),
      maxAge: 10 * 60,
    });
  }
  // An expired or revoked session: drop it.
  if (token) response.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return response;
}

export const config = {
  matcher: ["/((?!login|auth/|_next/static|_next/image|favicon.ico).*)"],
};
