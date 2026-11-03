import { redirect } from "next/navigation";

import { api } from "@/lib/api-client";
import { LOGIN_PATH } from "@/lib/session";

import { PasswordForm } from "./password-form";

export const metadata = { title: "Change password · health-mcp" };
export const dynamic = "force-dynamic";

/** Changing one's password; required (by the proxy) after a temporary one. */
export default async function ChangePasswordPage() {
  const session = await api.getSession();
  if (session.mode === "off") redirect("/");
  if (!session.user) redirect(LOGIN_PATH);
  const { user } = session;

  return (
    <div className="card login">
      <h1>{user.mustChangePassword ? "Choose your own password" : "Change password"}</h1>
      {user.mustChangePassword && (
        <p className="muted">
          You signed in with a temporary password. Choose your own to continue; the temporary one
          stops working.
        </p>
      )}
      <PasswordForm
        owner={{ email: user.email, firstName: user.firstName, lastName: user.lastName }}
      />
    </div>
  );
}
