// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

const { registerWithApi, store, redirect } = vi.hoisted(() => ({
  registerWithApi: vi.fn(),
  store: { set: vi.fn() },
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { register: registerWithApi },
}));
vi.mock("next/headers", () => ({ cookies: async () => store }));
vi.mock("next/navigation", () => ({ redirect }));

const { register } = await import("@/app/register/actions");

afterEach(() => vi.clearAllMocks());

const PASSWORD = "my dog likes blue trains";
const fields = { firstName: "Ben", lastName: "Example", email: "ben@example.com" };
const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  const values = { ...fields, password: PASSWORD, repeatPassword: PASSWORD, ...overrides };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe("register", () => {
  it("creates the account, keeps the session in a cookie and opens the patients", async () => {
    registerWithApi.mockResolvedValueOnce({
      session: "sealed-session",
      user: { email: "ben@example.com", firstName: "Ben", lastName: "Example" },
      expiresAt: "2026-11-03T00:00:00.000Z",
    });

    await expect(register({}, form())).rejects.toThrow("NEXT_REDIRECT /patients");

    expect(registerWithApi).toHaveBeenCalledWith({ ...fields, password: PASSWORD });
    expect(store.set).toHaveBeenCalledWith("hm_session", "sealed-session", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: new Date("2026-11-03T00:00:00.000Z"),
    });
  });

  it("refuses passwords that differ, without calling the api", async () => {
    expect(await register({}, form({ repeatPassword: "something else" }))).toEqual({
      ...fields,
      error: "The passwords do not match.",
    });
    expect(registerWithApi).not.toHaveBeenCalled();
  });

  it.each([400, 403, 409, 429])("shows the api's answer to %i, keeping fields", async (status) => {
    const body = { statusCode: status, error: "Refused", message: `Answer ${status}.` };
    registerWithApi.mockRejectedValueOnce(new ApiRequestError(status, body));

    expect(await register({}, form())).toEqual({ ...fields, error: `Answer ${status}.` });
    expect(store.set).not.toHaveBeenCalled();
  });

  it("says sign-up is unavailable when the api is down or fails", async () => {
    const error = "Sign-up is not available right now. Try again later.";
    const unavailable = { ...fields, error };
    registerWithApi.mockRejectedValueOnce(new ApiUnavailableError("down"));
    expect(await register({}, form())).toEqual(unavailable);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    registerWithApi.mockRejectedValueOnce(new ApiRequestError(500, undefined));
    expect(await register({}, form())).toEqual(unavailable);
    log.mockRestore();
  });

  it("refuses fields over the limits", async () => {
    expect(await register({}, form({ firstName: "x".repeat(101) }))).toMatchObject({
      error: "Check the fields: some are too long.",
    });
  });
});
