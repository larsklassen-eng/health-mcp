// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
  }),
}));
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { api, ApiRequestError } = await import("@/lib/api-client");
const { safeReturnPath, sessionHeaders } = await import("@/lib/session");

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => {
  fetchMock.mockReset();
  redirect.mockClear();
  cookieStore.clear();
});

const respond = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
const sentHeaders = () => new Headers(fetchMock.mock.calls[0]![1]?.headers);
const unauthorized = { statusCode: 401, error: "Unauthorized", message: "Sign in to continue." };

describe("the session in api requests", () => {
  it("sends the session cookie as a bearer token", async () => {
    cookieStore.set("hm_session", "sealed-session");
    respond(200, { patients: [] });

    await api.listPatients();

    expect(sentHeaders().get("authorization")).toBe("Bearer sealed-session");
  });

  it("sends no Authorization header without a session", async () => {
    respond(200, { patients: [] });

    await api.listPatients();

    expect(sentHeaders().has("authorization")).toBe(false);
    expect(await sessionHeaders()).toEqual({});
  });

  it("goes to the login page when the api says the session ended", async () => {
    cookieStore.set("hm_session", "expired");
    respond(401, unauthorized);

    await expect(api.listPatients()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("sign-in calls", () => {
  it("reads the session, treating 401 as signed out", async () => {
    respond(200, { mode: "password", user: { email: "ana@example.com" } });
    respond(401, unauthorized);
    respond(200, { mode: "off", user: null });

    expect(await api.getSession("token")).toEqual({
      mode: "password",
      user: { email: "ana@example.com" },
    });
    expect(await api.getSession(null)).toEqual({ mode: "password", user: null });
    expect(await api.getSession(null)).toEqual({ mode: "off", user: null });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("authorization")).toBe(
      "Bearer token",
    );
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).has("authorization")).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("signs in without sending a session, keeping the api's errors for the caller", async () => {
    cookieStore.set("hm_session", "old-session");
    respond(200, {
      session: "sealed",
      user: { email: "ana@example.com" },
      expiresAt: "2026-10-30T00:00:00.000Z",
    });
    respond(401, { statusCode: 401, error: "Unauthorized", message: "The email or password…" });

    expect((await api.login({ email: "ana@example.com", password: "pw" })).session).toBe("sealed");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/auth/login");
    expect(JSON.parse(init?.body as string)).toEqual({ email: "ana@example.com", password: "pw" });
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    await expect(api.login({ email: "ana@example.com", password: "x" })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("safeReturnPath", () => {
  it.each([
    ["/patients/p1/chat?x=1", "/patients/p1/chat?x=1"],
    ["/dashboard", "/dashboard"],
    [undefined, "/patients"],
    ["https://evil.example.test", "/patients"],
    ["//evil.example.test", "/patients"],
    ["/\\evil.example.test", "/patients"],
    ["/login?error=failed", "/patients"],
    ["/auth/callback", "/patients"],
  ])("returns %j as %j", (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });
});
