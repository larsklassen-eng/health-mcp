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
    respond(200, { mode: "google", user: { email: "ana@example.com" } });
    respond(401, unauthorized);
    respond(200, { mode: "off", user: null });

    expect(await api.getSession("token")).toEqual({
      mode: "google",
      user: { email: "ana@example.com" },
    });
    expect(await api.getSession(null)).toEqual({ mode: "google", user: null });
    expect(await api.getSession(null)).toEqual({ mode: "off", user: null });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("authorization")).toBe(
      "Bearer token",
    );
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).has("authorization")).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("starts and finishes a sign-in, keeping the api's 403 for the caller", async () => {
    respond(200, { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", loginState: "s" });
    respond(403, { statusCode: 403, error: "Forbidden", message: "eve@example.com may not…" });

    expect(await api.startSignIn()).toEqual({
      url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      loginState: "s",
    });
    const finishing = api.finishSignIn({ code: "c", state: "st", loginState: "s" });
    await expect(finishing).rejects.toBeInstanceOf(ApiRequestError);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("http://api.test/auth/google/callback");
    expect(JSON.parse(init?.body as string)).toEqual({ code: "c", state: "st", loginState: "s" });
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
