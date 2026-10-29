import { cookies } from "next/headers";

/*
 * Sign-in cookies. The api signs every value; this app only keeps them,
 * HTTP-only so page scripts cannot read them, and sends the session to the
 * api as `Authorization: Bearer <session>` (see `api-client.ts`).
 */

/** The session, for every api request. */
export const SESSION_COOKIE = "hm_session";
/** The state of a sign-in in progress, until Google sends the browser back. */
export const LOGIN_STATE_COOKIE = "hm_login";
/** The page to return to after signing in. */
export const RETURN_TO_COOKIE = "hm_return_to";

export const LOGIN_PATH = "/login";
const HOME_PATH = "/patients";

/** This app's public URL, as Google and the browser see it (same as the api's WEB_ORIGIN). */
export const webOrigin = (): string => process.env.WEB_ORIGIN ?? "http://localhost:3000";

/** Cookie settings: Secure whenever the app is served over HTTPS. */
export const cookieOptions = (path = "/") =>
  ({
    httpOnly: true,
    sameSite: "lax",
    secure: webOrigin().startsWith("https://"),
    path,
  }) as const;

/** `Authorization` for api requests made while handling a browser request; empty otherwise. */
export async function sessionHeaders(): Promise<Record<string, string>> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return {}; // outside a request, e.g. in tests
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** A path on this site to return to after signing in; anything else becomes the patients list. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return HOME_PATH;
  return value.startsWith(LOGIN_PATH) || value.startsWith("/auth/") ? HOME_PATH : value;
}
