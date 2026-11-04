import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PatientAccess } from "@/app/patients/[id]/patient-access";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const patient = { firstName: "Pat", lastName: "Morales" };
const account = {
  email: "pat@example.com",
  mustChangePassword: true,
  createdAt: "2026-11-01T10:00:00.000Z",
};

/** Waits for the password rules (zxcvbn) to load. */
const rulesLoaded = () =>
  waitFor(
    () => expect(screen.getByRole("button", { name: "Suggest a strong password" })).toBeEnabled(),
    // The zxcvbn dictionaries take a while to load when every suite runs at once.
    { timeout: 10_000 },
  );

describe("PatientAccess", () => {
  it("creates an account with a checked temporary password, then shows it once", async () => {
    const action = vi.fn().mockResolvedValue({
      issued: { email: "pat@example.com", password: "my dog likes blue trains" },
    });
    const user = userEvent.setup();
    render(<PatientAccess account={null} patient={patient} action={action} />);
    await rulesLoaded();
    const create = screen.getByRole("button", { name: "Create account" });

    await user.type(screen.getByLabelText("Patient's email"), "pat@example.com");
    await user.type(screen.getByLabelText("Temporary password"), "Morales forever 2026");
    expect(
      screen.getByText("Leave your name and email address out of the password."),
    ).toBeInTheDocument();
    expect(create).toBeDisabled();

    await user.clear(screen.getByLabelText("Temporary password"));
    await user.type(screen.getByLabelText("Temporary password"), "my dog likes blue trains");
    await user.click(create);

    const sent = action.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(sent)).toEqual({
      intent: "create",
      email: "pat@example.com",
      password: "my dog likes blue trains",
    });
    const issued = await screen.findByRole("status");
    expect(issued).toHaveTextContent("Give Pat these sign-in details");
    expect(issued).toHaveTextContent("http://localhost:3000/login");
    expect(issued).toHaveTextContent("my dog likes blue trains");
  });

  it("suggests a temporary password that passes the rules", async () => {
    const user = userEvent.setup();
    render(<PatientAccess account={null} patient={patient} action={vi.fn()} />);
    await rulesLoaded();

    await user.type(screen.getByLabelText("Patient's email"), "pat@example.com");
    await user.click(screen.getByRole("button", { name: "Suggest a strong password" }));

    const password = screen.getByLabelText<HTMLInputElement>("Temporary password");
    expect(password.value).toMatch(/^(\w{5}-){3}\w{5}$/);
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("shows the account and whether the temporary password was replaced", () => {
    const { rerender } = render(
      <PatientAccess account={account} patient={patient} action={vi.fn()} />,
    );
    expect(screen.getByText("pat@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the first sign-in/)).toBeInTheDocument();

    rerender(
      <PatientAccess
        account={{ ...account, mustChangePassword: false }}
        patient={patient}
        action={vi.fn()}
      />,
    );
    expect(screen.getByText(/chosen their own password/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Patient's email")).not.toBeInTheDocument();
  });

  it("resets the password with a new temporary one", async () => {
    const action = vi.fn().mockResolvedValue({
      issued: { email: "pat@example.com", password: "violet-tram-orbit-91" },
    });
    const user = userEvent.setup();
    render(<PatientAccess account={account} patient={patient} action={action} />);

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await rulesLoaded();
    await user.type(screen.getByLabelText("Temporary password"), "violet-tram-orbit-91");
    await user.click(screen.getByRole("button", { name: "Set temporary password" }));

    expect(Object.fromEntries(action.mock.calls[0]![1] as FormData)).toEqual({
      intent: "reset",
      password: "violet-tram-orbit-91",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("violet-tram-orbit-91");
    // The form closes (an effect after the details appear), so the account's buttons are back.
    await waitFor(() =>
      expect(screen.queryByLabelText("Temporary password")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Remove access" })).toBeInTheDocument();
  });

  it("removes access only after confirming", async () => {
    const action = vi.fn().mockResolvedValue({});
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const user = userEvent.setup();
    render(<PatientAccess account={account} patient={patient} action={action} />);

    await user.click(screen.getByRole("button", { name: "Remove access" }));
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove access" }));

    expect(confirm).toHaveBeenLastCalledWith(
      "Remove Pat's access? They can no longer sign in; their record stays.",
    );
    expect(Object.fromEntries(action.mock.calls[0]![1] as FormData)).toEqual({ intent: "remove" });
  });

  it("shows the api's answer", async () => {
    const action = vi.fn().mockResolvedValue({
      email: "taken@example.com",
      error: "An account with this email exists.",
    });
    const user = userEvent.setup();
    render(<PatientAccess account={null} patient={patient} action={action} />);
    await rulesLoaded();

    await user.type(screen.getByLabelText("Patient's email"), "taken@example.com");
    await user.type(screen.getByLabelText("Temporary password"), "my dog likes blue trains");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with this email exists.",
    );
  });
});
