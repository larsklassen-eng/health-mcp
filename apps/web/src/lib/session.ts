import type { AuthUser } from "@health-mcp/shared";
import { cookies } from "next/headers";

/*
 * Sign-in cookies. The api signs the session; this app only keeps it,
 * HTTP-only so page scripts cannot read it, and sends it to the api as
 * `Authorization: Bearer <session>` (see `api-client.ts`).
 */

/** The session, for every api request. */
export const SESSION_COOKIE = "hm_session";
/** The page to return to after signing in. */
export const RETURN_TO_COOKIE = "hm_return_to";

export const LOGIN_PATH = "/login";
/** Changing one's password; the only page until a temporary password is replaced. */
export const PASSWORD_PATH = "/account/password";
const HOME_PATH = "/patients";

/** Whether the session is a patient's own account (who sees only their own record). */
export const isPatient = (session: { user: Pick<AuthUser, "role"> | null } | undefined) =>
  session?.user?.role === "patient";

/** Where a user starts: a patient's own dashboard, the patients list for doctors. */
export const homePath = (user: Pick<AuthUser, "role" | "patientId"> | null | undefined): string =>
  user?.role === "patient" && user.patientId
    ? `/patients/${encodeURIComponent(user.patientId)}/dashboard`
    : HOME_PATH;

/**
 * Whether `user` may open `pathname` in this app (the api checks again):
 * only the password page with a temporary password; for a patient, only their
 * own record's pages (profile, dashboard, imaging and its images).
 */
export function mayOpen(
  user: Pick<AuthUser, "role" | "patientId" | "mustChangePassword">,
  pathname: string,
): boolean {
  if (pathname === PASSWORD_PATH) return true;
  if (user.mustChangePassword) return false;
  if (user.role !== "patient") return true;
  if (!user.patientId) return false;
  const own = `/patients/${encodeURIComponent(user.patientId)}`;
  if (pathname !== own && !pathname.startsWith(`${own}/`)) return false;
  // The profile, the dashboard, a study and its images (not the upload page).
  return /^(\/dashboard|\/imaging\/(?!upload$)[^/]+(\/series\/[^/]+\/images\/[^/]+)?)?$/.test(
    pathname.slice(own.length),
  );
}

/** This app's public URL, as the browser sees it (same as the api's WEB_ORIGIN). */
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
