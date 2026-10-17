import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PatientForm } from "@/app/patients/patient-form";
import type { PatientFormState } from "@/app/patients/form-state";

describe("PatientForm", () => {
  it("submits every field to the action", async () => {
    const action = vi
      .fn<(state: PatientFormState, data: FormData) => Promise<PatientFormState>>()
      .mockResolvedValue({});
    const user = userEvent.setup();
    render(<PatientForm action={action} />);

    await user.type(screen.getByLabelText("First name"), "Ana");
    await user.type(screen.getByLabelText("Last name"), "Test");
    await user.type(screen.getByLabelText("MRN"), "FAKE-001");
    await user.selectOptions(screen.getByLabelText("Sex"), "female");
    await user.type(screen.getByLabelText("Diagnosis"), "Synthetic meningioma");
    await user.click(screen.getByRole("button", { name: "Create patient" }));

    expect(action).toHaveBeenCalledOnce();
    const data = action.mock.calls[0]![1];
    expect(Object.fromEntries(data)).toMatchObject({
      firstName: "Ana",
      lastName: "Test",
      mrn: "FAKE-001",
      sex: "female",
      status: "active",
      diagnosis: "Synthetic meningioma",
    });
  });

  it("shows field errors next to their inputs and keeps the typed values", async () => {
    const action = vi.fn().mockResolvedValue({
      values: { firstName: "Ana", mrn: "FAKE-001" },
      fieldErrors: { mrn: "A patient with this MRN already exists" },
    } satisfies PatientFormState);
    const user = userEvent.setup();
    render(<PatientForm action={action} />);

    await user.click(screen.getByRole("button", { name: "Create patient" }));

    // The input is there from the start; wait for the error the action returns.
    await screen.findByText("A patient with this MRN already exists");
    const mrn = screen.getByLabelText("MRN");
    expect(mrn).toHaveAttribute("aria-invalid", "true");
    expect(mrn).toHaveAccessibleDescription("A patient with this MRN already exists");
    expect(mrn).toHaveValue("FAKE-001");
    expect(screen.getByLabelText("First name")).toHaveValue("Ana");
    expect(screen.getByLabelText("First name")).not.toHaveAttribute("aria-invalid");
  });

  it("shows form-level errors as an alert", async () => {
    const action = vi.fn().mockResolvedValue({
      formError: "Could not reach the API at http://api.test. Is it running?",
    });
    const user = userEvent.setup();
    render(<PatientForm action={action} />);

    await user.click(screen.getByRole("button", { name: "Create patient" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the API");
  });

  it("starts from the given values and uses the given button label", async () => {
    const action = vi.fn().mockResolvedValue({});
    render(
      <PatientForm
        action={action}
        initialValues={{ firstName: "Ana", sex: "male", status: "inactive", notes: "" }}
        submitLabel="Save changes"
      />,
    );

    expect(screen.getByLabelText("First name")).toHaveValue("Ana");
    expect(screen.getByLabelText("Sex")).toHaveValue("male");
    expect(screen.getByLabelText("Status")).toHaveValue("inactive");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save changes" }));
    expect(action).toHaveBeenCalledOnce();
  });
});
