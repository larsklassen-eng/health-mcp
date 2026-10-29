import type { AuthUser } from "@health-mcp/shared";

/** The signed-in user and a sign-out button, in the header. */
export function UserMenu({ user }: { user: AuthUser }) {
  return (
    <form className="user-menu" action="/auth/logout" method="post">
      <span className="muted" title={user.email}>
        {user.name ?? user.email}
      </span>
      <button type="submit" className="link-button">
        Sign out
      </button>
    </form>
  );
}
