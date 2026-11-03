import type { AuthUser } from "@health-mcp/shared";
import Link from "next/link";

/** The signed-in user and a sign-out button, in the header. */
export function UserMenu({ user }: { user: AuthUser }) {
  // Users added before first and last names were required may have neither.
  const name = `${user.firstName} ${user.lastName}`.trim();
  return (
    <form className="user-menu" action="/auth/logout" method="post">
      <span className="muted" title={user.email}>
        {name || user.email}
      </span>
      <Link href="/account/password" className="small">
        Change password
      </Link>
      <button type="submit" className="link-button">
        Sign out
      </button>
    </form>
  );
}
