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
vi.mock("@/app/login/actions", () => ({ signIn: vi.fn() }));

const { default: LoginPage } = await import("@/app/login/page");
const { UserMenu } = await import("@/app/user-menu");

afterEach(() => vi.clearAllMocks());

const page = async (params: Record<string, string> = {}) =>
  render(await LoginPage({ searchParams: Promise.resolve(params) }));

describe("login page", () => {
  it("asks for an email and a password", async () => {
    getSession.mockResolvedValueOnce({ mode: "password", user: null });

    await page();

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("confirms a sign-out", async () => {
    getSession.mockResolvedValueOnce({ mode: "password", user: null });

    await page({ "signed-out": "" });

    expect(screen.getByRole("status")).toHaveTextContent("You are signed out.");
  });

  it.each([
    ["signed in", { mode: "password", user: { email: "ana@example.com" } }],
    ["sign-in is off", { mode: "off", user: null }],
  ])("goes to the patients list when %s", async (_, session) => {
    getSession.mockResolvedValueOnce(session);

    await expect(page()).rejects.toThrow("NEXT_REDIRECT /patients");
  });
});

describe("UserMenu", () => {
  it("shows the user's name, or the email, and a sign-out button", () => {
    const { rerender } = render(<UserMenu user={{ email: "ana@example.com", name: "Ana" }} />);
    expect(screen.getByText("Ana")).toHaveAttribute("title", "ana@example.com");

    rerender(<UserMenu user={{ email: "ana@example.com" }} />);
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form")!;
    expect(form).toHaveAttribute("action", "/auth/logout");
    expect(form).toHaveAttribute("method", "post");
  });
});
