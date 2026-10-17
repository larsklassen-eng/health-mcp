import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeletePatientButton } from "@/app/patients/[id]/edit/delete-patient-button";

afterEach(() => vi.unstubAllGlobals());

const setup = (confirmed: boolean, result = {}) => {
  const confirm = vi.fn(() => confirmed);
  vi.stubGlobal("confirm", confirm);
  const action = vi.fn().mockResolvedValue(result);
  render(<DeletePatientButton action={action} patientName="Ana Test" />);
  return { confirm, action, user: userEvent.setup() };
};

describe("DeletePatientButton", () => {
  it("asks for confirmation, naming the patient and what is deleted", async () => {
    const { confirm, action, user } = setup(true);

    await user.click(screen.getByRole("button", { name: "Delete patient" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Delete Ana Test?"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("chat history"));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
  });

  it("does nothing when the user cancels", async () => {
    const { action, user } = setup(false);

    await user.click(screen.getByRole("button", { name: "Delete patient" }));

    expect(action).not.toHaveBeenCalled();
  });

  it("shows the action's error", async () => {
    const { user } = setup(true, { formError: "The patient could not be deleted." });

    await user.click(screen.getByRole("button", { name: "Delete patient" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be deleted");
  });
});
