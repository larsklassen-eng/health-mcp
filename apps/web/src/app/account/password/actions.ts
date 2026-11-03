"use server";

import { ChangePasswordInputSchema } from "@health-mcp/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";
import { cookieOptions, homePath, SESSION_COOKIE } from "@/lib/session";

export interface ChangePasswordState {
  error?: string;
}

/** The api's own answers, shown as they are: they say what to fix. */
const SHOWN_STATUSES = new Set([400, 429]);

/**
 * Replaces the user's password with the api, keeps the new session (the
 * change ends every earlier one) and opens their start page. The api checks
 * the password rules again; the form only shows them.
 */
export async function changePassword(
  _previous: ChangePasswordState,
  form: FormData,
): Promise<ChangePasswordState> {
  const newPassword = String(form.get("newPassword") ?? "");
  if (newPassword !== String(form.get("repeatPassword") ?? ""))
    return { error: "The new passwords do not match." };
  const parsed = ChangePasswordInputSchema.safeParse({
    currentPassword: String(form.get("currentPassword") ?? ""),
    newPassword,
  });
  if (!parsed.success) return { error: "The password is too long." };

  let changed;
  try {
    changed = await api.changePassword(parsed.data);
  } catch (error) {
    if (error instanceof ApiRequestError && SHOWN_STATUSES.has(error.status))
      return { error: error.message };
    if (!(error instanceof ApiUnavailableError)) console.error("Password change failed", error);
    return { error: "The password could not be changed right now. Try again later." };
  }

  (await cookies()).set(SESSION_COOKIE, changed.session, {
    ...cookieOptions(),
    expires: new Date(changed.expiresAt),
  });
  redirect(homePath(changed.user));
}
