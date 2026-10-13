import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "health-mcp",
  description: "Health recovery assistant (synthetic data only)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="header-inner">
            <Link href="/patients" className="brand">
              health-mcp
            </Link>
            <nav>
              <Link href="/patients">Patients</Link>
            </nav>
          </div>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
