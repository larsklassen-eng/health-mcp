import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

import { api } from "@/lib/api-client";
import { homePath } from "@/lib/session";

import { SiteNav } from "./site-nav";
import { UserMenu } from "./user-menu";

export const metadata: Metadata = {
  // Pages set their own title, e.g. "Sign in", shown as "Sign in · Health MCP".
  title: { default: "Health MCP · Patient recovery", template: "%s · Health MCP" },
  description: "Health recovery assistant (synthetic data only)",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The api may be down; pages say so themselves.
  const session = await api.getSession().catch(() => undefined);
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="header-inner">
            <Link href={homePath(session?.user)} className="brand">
              health-mcp
            </Link>
            <SiteNav session={session} />
            {session?.user && <UserMenu user={session.user} />}
          </div>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
