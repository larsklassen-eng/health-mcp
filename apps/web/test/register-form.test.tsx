import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/app/register/actions", () => ({ register }));

const { RegisterForm } = await import("@/app/register/register-form");

afterEach(() => vi.clearAllMocks());

/** Renders the form and waits for the password rules to load. */
async function renderForm() {
  const user = userEvent.setup();
  render(<RegisterForm />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Suggest a strong password" })).toBeEnabled(),
  );
  await user.type(screen.getByLabelText("First name"), "Ana");
  await user.type(screen.getByLabelText("Last name"), "Example");
  await user.type(screen.getByLabelText("Email"), "ana@example.com");
  return user;
}

const submit = () => screen.getByRole("button", { name: "Create account" });

describe("RegisterForm", () => {
  it("asks for names, email and a new password, with the right autocomplete", async () => {
    await renderForm();

    expect(screen.getByLabelText("First name")).toHaveAttribute("autocomplete", "given-name");
    expect(screen.getByLabelText("Last name")).toHaveAttribute("autocomplete", "family-name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByText(/At least 12 characters, hard to guess/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("explains a weak password and keeps the button disabled", async () => {
    const user = await renderForm();

    await user.type(screen.getByLabelText("Password"), "password1234");

    expect(screen.getByText("This is similar to a commonly used password.")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("value", "1");
    expect(screen.getByText("Weak")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Repeat the password"), "password1234");
    expect(submit()).toBeDisabled();
  });

  it("refuses the user's own name in the password", async () => {
    const user = await renderForm();

    await user.type(screen.getByLabelText("Password"), "Example rocks 2026!");

    expect(
      screen.getByText("Leave your name and email address out of the password."),
    ).toBeInTheDocument();
  });

  it("enables the button once a good password is repeated", async () => {
    const user = await renderForm();

    await user.type(screen.getByLabelText("Password"), "my dog likes blue trains");
    expect(screen.getByText("Good password.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Repeat the password"), "my dog likes blue train");
    expect(screen.getByText("The passwords differ.")).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    await user.type(screen.getByLabelText("Repeat the password"), "s");

    expect(screen.queryByText("The passwords differ.")).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it("suggests a strong password, fills both fields and shows it", async () => {
    const user = await renderForm();

    await user.click(screen.getByRole("button", { name: "Suggest a strong password" }));

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.value).toMatch(/^(\w{5}-){3}\w{5}$/);
    expect(screen.getByLabelText("Repeat the password")).toHaveValue(password.value);
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
    expect(submit()).toBeEnabled();
  });

  it("shows and hides the password", async () => {
    const user = await renderForm();

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Repeat the password")).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("sends the form and shows the api's answer", async () => {
    register.mockResolvedValueOnce({
      firstName: "Ana",
      lastName: "Example",
      email: "ana@example.com",
      error: "An account with this email exists. Sign in instead.",
    });
    const user = await renderForm();
    await user.type(screen.getByLabelText("Password"), "my dog likes blue trains");
    await user.type(screen.getByLabelText("Repeat the password"), "my dog likes blue trains");

    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with this email exists. Sign in instead.",
    );
    const sent = register.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(sent)).toEqual({
      firstName: "Ana",
      lastName: "Example",
      email: "ana@example.com",
      password: "my dog likes blue trains",
      repeatPassword: "my dog likes blue trains",
    });
  });
});
