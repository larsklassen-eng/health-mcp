// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { getSession },
}));

const { POST: logoutRoute } = await import("@/app/auth/logout/route");
const { proxy } = await import("@/proxy");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const request = (
  path: string,
  init: { cookies?: Record<string, string>; accept?: string; method?: string } = {},
) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: init.accept ?? "text/html",
      ...(init.cookies && {
        cookie: Object.entries(init.cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
      }),
    },
  });

/** The response's Set-Cookie headers by cookie name. */
const setCookies = (response: Response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((cookie) => [cookie.split("=")[0], cookie]),
  );

describe("POST /auth/logout", () => {
  it("deletes the session cookie and shows the login page", () => {
    const response = logoutRoute();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?signed-out");
    expect(setCookies(response).hm_session).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("proxy", () => {
  it("lets requests through when sign-in is off or the session is valid", async () => {
    getSession.mockResolvedValueOnce({ mode: "off", user: null });
    getSession.mockResolvedValueOnce({ mode: "password", user: { email: "ana@example.com" } });

    for (const cookies of [undefined, { hm_session: "valid" }]) {
      const response = await proxy(request("/patients", cookies && { cookies }));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(getSession).toHaveBeenNthCalledWith(1, null);
    expect(getSession).toHaveBeenNthCalledWith(2, "valid");
  });

  it("sends signed-out visits to the login page, remembering the page", async () => {
    getSession.mockResolvedValueOnce({ mode: "password", user: null });

    const response = await proxy(
      request("/patients/p1/chat?x=1", { cookies: { hm_session: "expired" } }),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    const cookies = setCookies(response);
    expect(cookies.hm_return_to).toMatch(/^hm_return_to=%2Fpatients%2Fp1%2Fchat%3Fx%3D1;/);
    expect(cookies.hm_session).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("answers 401 to signed-out requests that are not page visits", async () => {
    getSession.mockResolvedValueOnce({ mode: "password", user: null });

    const response = await proxy(
      request("/patients/p1/chat/stream", { method: "POST", accept: "text/event-stream" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: "Sign in to continue." });
  });

  it("lets requests through when the api is down, so pages can say so", async () => {
    getSession.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const response = await proxy(request("/patients"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
