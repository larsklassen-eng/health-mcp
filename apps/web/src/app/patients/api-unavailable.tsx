import { apiUrl } from "@/lib/api-client";

/** Shown instead of page content when apps/api cannot be reached. Rendered on the server. */
export function ApiUnavailable() {
  return (
    <div className="alert error" role="alert">
      <strong>The api is not reachable at {apiUrl()}.</strong> Start it with <code>yarn dev</code>, or set{" "}
      <code>API_URL</code> to where it runs, then reload this page.
    </div>
  );
}
