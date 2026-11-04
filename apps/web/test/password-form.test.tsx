import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/account/password/actions", () => ({ changePassword: vi.fn() }));

const { PasswordForm } = await import("@/app/account/password/password-form");

const owner = { email: "pat@example.com", firstName: "Pat", lastName: "Morales" };

async function renderForm() {
  const user = userEvent.setup();
  render(<PasswordForm owner={owner} />);
  await waitFor(
    () => expect(screen.getByRole("button", { name: "Suggest a strong password" })).toBeEnabled(),
    // The zxcvbn dictionaries take a while to load when every suite runs at once.
    { timeout: 10_000 },
  );
  return user;
}
const submit = () => screen.getByRole("button", { name: "Change password" });

describe("PasswordForm", () => {
  it("checks the new password with the user's own names", async () => {
    const user = await renderForm();
    await user.type(screen.getByLabelText("Current password"), "my dog likes blue trains");

    await user.type(screen.getByLabelText("New password"), "Morales forever 2026");

    expect(
      screen.getByText("Leave your name and email address out of the password."),
    ).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("refuses the current password as the new one", async () => {
    const user = await renderForm();
    await user.type(screen.getByLabelText("Current password"), "my dog likes blue trains");

    await user.type(screen.getByLabelText("New password"), "my dog likes blue trains");
    await user.type(screen.getByLabelText("Repeat the new password"), "my dog likes blue trains");

    expect(
      screen.getByText("Choose a password different from the current one."),
    ).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("is ready once a good new password is repeated, or suggested", async () => {
    const user = await renderForm();
    await user.type(screen.getByLabelText("Current password"), "my dog likes blue trains");

    await user.click(screen.getByRole("button", { name: "Suggest a strong password" }));

    const password = screen.getByLabelText<HTMLInputElement>("New password");
    expect(password.value).toMatch(/^(\w{5}-){3}\w{5}$/);
    expect(screen.getByLabelText("Repeat the new password")).toHaveValue(password.value);
    expect(submit()).toBeEnabled();
  });
});
