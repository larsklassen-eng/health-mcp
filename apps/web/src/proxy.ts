import { type NextRequest, NextResponse } from "next/server";

import { api } from "@/lib/api-client";
import {
  cookieOptions,
  homePath,
  LOGIN_PATH,
  mayOpen,
  PASSWORD_PATH,
  RETURN_TO_COOKIE,
  SESSION_COOKIE,
  webOrigin,
} from "@/lib/session";

/**
 * Runs before every page and route except sign-in, sign-up, the DICOM upload
 * and static files. When sign-in is on and the request has no valid session,
 * pages redirect to the login page (remembering where the user was going) and
 * other requests get 401. Signed in, a temporary password leads only to the
 * password page, and a patient only to their own record's pages (see
 * `mayOpen`); other pages redirect there, other requests get 403. The api
 * checks all of this again on every call, so this is the friendly front door,
 * not the only lock.
 *
 * The DICOM upload (up to 2 GB) is left out because Next.js buffers the body
 * of every request the proxy sees and cuts it at 10 MB. Its route streams the
 * zip to the api with the session, and the api refuses it without one.
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
  const isPage =
    request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  if (session.mode === "off") return NextResponse.next();
  if (session.user) {
    const { user } = session;
    if (mayOpen(user, request.nextUrl.pathname)) return NextResponse.next();
    const message = user.mustChangePassword
      ? "Choose a new password first."
      : "Patient accounts cannot use this.";
    return isPage
      ? NextResponse.redirect(
          new URL(user.mustChangePassword ? PASSWORD_PATH : homePath(user), webOrigin()),
        )
      : NextResponse.json({ statusCode: 403, error: "Forbidden", message }, { status: 403 });
  }

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
  matcher: [
    "/((?!login|register|auth/|_next/static|_next/image|favicon.ico|patients/[^/]+/imaging/dicom$).*)",
  ],
};
