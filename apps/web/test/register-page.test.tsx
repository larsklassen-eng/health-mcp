import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { getSession },
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/app/register/actions", () => ({ register: vi.fn() }));
vi.mock("@/app/login/actions", () => ({ signIn: vi.fn() }));

const { default: RegisterPage } = await import("@/app/register/page");
const { default: LoginPage } = await import("@/app/login/page");
const { config } = await import("@/proxy");

afterEach(() => vi.clearAllMocks());

describe("register page", () => {
  it("shows the sign-up form and links to sign-in", async () => {
    getSession.mockResolvedValueOnce({ mode: "password", user: null });

    render(await RegisterPage());

    expect(screen.getByRole("heading", { name: "Create an account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it.each([
    ["signed in", { mode: "password", user: { email: "ana@example.com" } }],
    ["sign-in is off", { mode: "off", user: null }],
  ])("goes to the patients list when %s", async (_, session) => {
    getSession.mockResolvedValueOnce(session);

    await expect(RegisterPage()).rejects.toThrow("NEXT_REDIRECT /patients");
  });

  it("is linked from the login page", async () => {
    getSession.mockResolvedValueOnce({ mode: "password", user: null });

    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("is reachable without a session: the proxy skips it", () => {
    const [matcher] = config.matcher;
    const guarded = (path: string) => new RegExp(`^${matcher}$`).test(path);

    expect(guarded("/register")).toBe(false);
    expect(guarded("/login")).toBe(false);
    expect(guarded("/patients")).toBe(true);
  });
});
