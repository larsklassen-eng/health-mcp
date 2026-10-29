// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api-client";

const { startSignIn, finishSignIn, getSession } = vi.hoisted(() => ({
  startSignIn: vi.fn(),
  finishSignIn: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { startSignIn, finishSignIn, getSession },
}));

const { GET: startRoute } = await import("@/app/auth/google/route");
const { GET: callbackRoute } = await import("@/app/auth/callback/route");
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

describe("GET /auth/google", () => {
  it("keeps the sign-in state in an HTTP-only cookie and redirects to Google", async () => {
    startSignIn.mockResolvedValueOnce({
      url: "https://accounts.google.com/auth?s=1",
      loginState: "ls",
    });

    const response = await startRoute();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/auth?s=1");
    const cookie = setCookies(response).hm_login!;
    expect(cookie).toMatch(/^hm_login=ls;/);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it("uses Secure cookies when the app is served over HTTPS", async () => {
    vi.stubEnv("WEB_ORIGIN", "https://health.example.test");
    startSignIn.mockResolvedValueOnce({
      url: "https://accounts.google.com/auth",
      loginState: "ls",
    });

    expect(setCookies(await startRoute()).hm_login).toMatch(/Secure/);
  });

  it("returns to the login page when the api cannot start a sign-in", async () => {
    startSignIn.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await startRoute();

    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=unavailable");
  });
});

describe("GET /auth/callback", () => {
  const signedIn = {
    session: "sealed-session",
    user: { email: "ana@example.com" },
    expiresAt: "2026-10-30T00:00:00.000Z",
  };

  it("stores the session and returns to the page the user wanted", async () => {
    finishSignIn.mockResolvedValueOnce(signedIn);

    const response = await callbackRoute(
      request("/auth/callback?code=c&state=st", {
        cookies: { hm_login: "ls", hm_return_to: "/patients/p1/chat" },
      }),
    );

    expect(finishSignIn).toHaveBeenCalledWith({ code: "c", state: "st", loginState: "ls" });
    expect(response.headers.get("location")).toBe("http://localhost:3000/patients/p1/chat");
    const cookies = setCookies(response);
    expect(cookies.hm_session).toMatch(/^hm_session=sealed-session;/);
    expect(cookies.hm_session).toMatch(/HttpOnly/);
    expect(cookies.hm_session).toMatch(/Path=\/;/);
    expect(cookies.hm_session).toMatch(/Expires=Fri, 30 Oct 2026 00:00:00 GMT/);
    expect(cookies.hm_login).toMatch(/Expires=Thu, 01 Jan 1970/); // deleted
    expect(cookies.hm_return_to).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("goes to the patients list without a return path", async () => {
    finishSignIn.mockResolvedValueOnce(signedIn);

    const response = await callbackRoute(
      request("/auth/callback?code=c&state=st", { cookies: { hm_login: "ls" } }),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/patients");
  });

  it.each([
    ["the user cancelled at Google", "/auth/callback?error=access_denied&state=st", "cancelled"],
    ["the sign-in cookie is gone", "/auth/callback?code=c&state=st", "expired"],
  ])("explains it when %s", async (_, path, reason) => {
    const response = await callbackRoute(request(path));

    expect(response.headers.get("location")).toBe(`http://localhost:3000/login?error=${reason}`);
    expect(finishSignIn).not.toHaveBeenCalled();
  });

  it.each([
    [403, "not-allowed"],
    [401, "failed"],
    [503, "unavailable"],
  ])("maps an api %i to %s", async (status, reason) => {
    finishSignIn.mockRejectedValueOnce(new ApiRequestError(status, undefined));

    const response = await callbackRoute(
      request("/auth/callback?code=c&state=st", { cookies: { hm_login: "ls" } }),
    );

    expect(response.headers.get("location")).toBe(`http://localhost:3000/login?error=${reason}`);
    expect(setCookies(response).hm_session).toBeUndefined();
  });
});

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
    getSession.mockResolvedValueOnce({ mode: "google", user: { email: "ana@example.com" } });

    for (const cookies of [undefined, { hm_session: "valid" }]) {
      const response = await proxy(request("/patients", cookies && { cookies }));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(getSession).toHaveBeenNthCalledWith(1, null);
    expect(getSession).toHaveBeenNthCalledWith(2, "valid");
  });

  it("sends signed-out visits to the login page, remembering the page", async () => {
    getSession.mockResolvedValueOnce({ mode: "google", user: null });

    const response = await proxy(
      request("/patients/p1/chat?x=1", { cookies: { hm_session: "expired" } }),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    const cookies = setCookies(response);
    expect(cookies.hm_return_to).toMatch(/^hm_return_to=%2Fpatients%2Fp1%2Fchat%3Fx%3D1;/);
    expect(cookies.hm_session).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("answers 401 to signed-out requests that are not page visits", async () => {
    getSession.mockResolvedValueOnce({ mode: "google", user: null });

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
