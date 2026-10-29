import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

import { api } from "@/lib/api-client";

import { UserMenu } from "./user-menu";

export const metadata: Metadata = {
  title: "health-mcp",
  description: "Health recovery assistant (synthetic data only)",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The api may be down; pages say so themselves.
  const session = await api.getSession().catch(() => undefined);
  const signedOut = session?.mode === "password" && !session.user;
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="header-inner">
            <Link href="/patients" className="brand">
              health-mcp
            </Link>
            {!signedOut && (
              <nav>
                <Link href="/dashboard">Dashboard</Link>
                <Link href="/patients">Patients</Link>
              </nav>
            )}
            {session?.user && <UserMenu user={session.user} />}
          </div>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
