import type { AuthSessionResponse } from "@health-mcp/shared";
import Link from "next/link";

import { homePath, isPatient } from "@/lib/session";

/** The header's links: doctors get the dashboard and patients list, patients their own record. */
export function SiteNav({ session }: { session: AuthSessionResponse | undefined }) {
  if (session?.mode === "password" && !session.user) return null;
  return isPatient(session) ? (
    <nav>
      <Link href={homePath(session?.user)}>My recovery</Link>
    </nav>
  ) : (
    <nav>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/patients">Patients</Link>
    </nav>
  );
}
