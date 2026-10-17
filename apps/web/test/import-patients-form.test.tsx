import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ImportPatientsState } from "@/app/patients/form-state";
import { ImportPatientsForm } from "@/app/patients/import-patients-form";

async function submitFile(state: ImportPatientsState) {
  const action = vi.fn().mockResolvedValue(state);
  const user = userEvent.setup();
  render(<ImportPatientsForm action={action} />);
  await user.upload(
    screen.getByLabelText(/JSON file/),
    new File(["{}"], "patients.json", { type: "application/json" }),
  );
  await user.click(screen.getByRole("button", { name: "Import" }));
  return action;
}

describe("ImportPatientsForm", () => {
  it("submits the form with the chosen file", async () => {
    const action = await submitFile({});

    expect(action).toHaveBeenCalledOnce();
    // happy-dom loses file contents when building FormData from a form (real browsers do not),
    // so check the file on the input that the browser will send.
    const input = screen.getByLabelText(/JSON file/) as HTMLInputElement;
    expect(input.name).toBe("file");
    expect(input.files?.[0]?.name).toBe("patients.json");
  });

  it("lists file problems", async () => {
    await submitFile({
      errors: ["patients.0.patient.mrn: Too small", "patients.1.labResults.0.flag: Invalid option"],
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nothing was imported");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "patients.0.patient.mrn: Too small",
      "patients.1.labResults.0.flag: Invalid option",
    ]);
  });

  it("shows what was imported with links to each patient", async () => {
    await submitFile({
      result: {
        imported: [
          { patientId: "p1", mrn: "FAKE-1", records: 5 },
          { patientId: "p2", mrn: "FAKE-2", records: 1 },
        ],
      },
    });

    expect(await screen.findByRole("status")).toHaveTextContent("Imported 2 patients.");
    expect(screen.getByRole("link", { name: "FAKE-1" })).toHaveAttribute("href", "/patients/p1");
    expect(screen.getByText(/1 record\)/)).toBeInTheDocument();
  });
});
