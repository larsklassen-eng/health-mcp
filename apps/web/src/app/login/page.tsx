import { redirect } from "next/navigation";

import { api } from "@/lib/api-client";

import type { SignInError } from "../auth/callback/route";

export const metadata = { title: "Sign in · health-mcp" };

const ERRORS: Record<SignInError, string> = {
  cancelled: "The sign-in was cancelled.",
  expired: "The sign-in took too long or was started in another tab. Try again.",
  "not-allowed": "This Google account may not use this deployment. Ask for access.",
  failed: "Google sign-in could not be completed. Try again.",
  unavailable: "Sign-in is not available right now: the api is not reachable.",
};

interface Props {
  searchParams: Promise<{ error?: string; "signed-out"?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const session = await api.getSession().catch(() => undefined);
  if (session && (session.mode === "off" || session.user)) redirect("/patients");

  const params = await searchParams;
  const error = params.error && ERRORS[params.error as SignInError];

  return (
    <div className="card login">
      <h1>Sign in</h1>
      <p className="muted">
        Use your Google account. Only people on this deployment&apos;s list can sign in.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {params["signed-out"] !== undefined && !error && <p role="status">You are signed out.</p>}
      {/* A plain link: /auth/google redirects to Google. */}
      <a className="button" href="/auth/google">
        Sign in with Google
      </a>
    </div>
  );
}
