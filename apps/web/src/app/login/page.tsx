import { redirect } from "next/navigation";

import { api } from "@/lib/api-client";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · health-mcp" };

interface Props {
  searchParams: Promise<{ "signed-out"?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const session = await api.getSession().catch(() => undefined);
  if (session && (session.mode === "off" || session.user)) redirect("/patients");

  const params = await searchParams;
  return (
    <div className="card login">
      <h1>Sign in</h1>
      {params["signed-out"] !== undefined && <p role="status">You are signed out.</p>}
      <LoginForm />
      <p className="muted small">Accounts are created by an administrator.</p>
    </div>
  );
}
