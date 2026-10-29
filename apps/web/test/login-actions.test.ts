// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

const { login, store, redirect } = vi.hoisted(() => ({
  login: vi.fn(),
  store: {
    values: new Map<string, string>(),
    set: vi.fn(),
    delete: vi.fn(),
    get(name: string) {
      return this.values.has(name) ? { name, value: this.values.get(name)! } : undefined;
    },
  },
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { login },
}));
vi.mock("next/headers", () => ({ cookies: async () => store }));
vi.mock("next/navigation", () => ({ redirect }));

const { signIn } = await import("@/app/login/actions");

afterEach(() => {
  vi.clearAllMocks();
  store.values.clear();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const signedIn = {
  session: "sealed-session",
  user: { email: "ana@example.com" },
  expiresAt: "2026-10-30T00:00:00.000Z",
};

describe("signIn", () => {
  it("keeps the session in an HTTP-only cookie and returns to the wanted page", async () => {
    login.mockResolvedValueOnce(signedIn);
    store.values.set("hm_return_to", "/patients/p1/chat");

    await expect(
      signIn({}, form({ email: "ana@example.com", password: "correct horse battery" })),
    ).rejects.toThrow("NEXT_REDIRECT /patients/p1/chat");

    expect(login).toHaveBeenCalledWith({
      email: "ana@example.com",
      password: "correct horse battery",
    });
    expect(store.set).toHaveBeenCalledWith("hm_session", "sealed-session", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: new Date("2026-10-30T00:00:00.000Z"),
    });
    expect(store.delete).toHaveBeenCalledWith("hm_return_to");
  });

  it("goes to the patients list without a safe return path", async () => {
    login.mockResolvedValueOnce(signedIn);
    store.values.set("hm_return_to", "https://evil.example.test");

    await expect(signIn({}, form({ email: "a@example.com", password: "pw" }))).rejects.toThrow(
      "NEXT_REDIRECT /patients",
    );
  });

  it("asks for both fields without calling the api", async () => {
    expect(await signIn({}, form({ email: "ana@example.com" }))).toEqual({
      email: "ana@example.com",
      error: "Enter your email and password.",
    });
    expect(login).not.toHaveBeenCalled();
  });

  it.each([
    [
      new ApiRequestError(401, {
        statusCode: 401,
        error: "x",
        message: "The email or password is incorrect.",
      }),
      "The email or password is incorrect.",
    ],
    [
      new ApiRequestError(429, {
        statusCode: 429,
        error: "x",
        message: "Too many failed sign-ins. Try again in 15 minutes.",
      }),
      "Too many failed sign-ins. Try again in 15 minutes.",
    ],
    [
      new ApiUnavailableError(new Error("ECONNREFUSED")),
      "Sign-in is not available right now. Try again later.",
    ],
  ])("shows the api's answer, keeping the email (%s)", async (error, message) => {
    login.mockRejectedValueOnce(error);

    expect(await signIn({}, form({ email: "ana@example.com", password: "wrong" }))).toEqual({
      email: "ana@example.com",
      error: message,
    });
    expect(store.set).not.toHaveBeenCalled();
  });
});
