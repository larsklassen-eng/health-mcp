import Link from "next/link";
import { redirect } from "next/navigation";

import { api } from "@/lib/api-client";

import { RegisterForm } from "./register-form";

export const metadata = { title: "Create an account · health-mcp" };

export default async function RegisterPage() {
  const session = await api.getSession().catch(() => undefined);
  if (session && (session.mode === "off" || session.user)) redirect("/patients");

  return (
    <div className="card login">
      <h1>Create an account</h1>
      <p className="muted">For doctors: you will see only the patients you add.</p>
      <RegisterForm />
      <p className="muted small">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
