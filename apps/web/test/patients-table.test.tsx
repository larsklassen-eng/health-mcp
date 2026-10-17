import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PatientsTable } from "@/app/patients/patients-table";

describe("PatientsTable", () => {
  it("shows an empty state with links to create or import", () => {
    render(<PatientsTable patients={[]} />);

    expect(screen.getByText("No patients yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a patient" })).toHaveAttribute(
      "href",
      "/patients/new",
    );
    expect(screen.getByRole("link", { name: "import a file of fake data" })).toHaveAttribute(
      "href",
      "/patients/import",
    );
  });

  it("lists patients with a link to each one", () => {
    render(
      <PatientsTable
        patients={[
          {
            id: "p1",
            mrn: "FAKE-001",
            firstName: "Ana",
            lastName: "Test",
            status: "active",
            diagnosis: "Synthetic meningioma",
          },
          {
            id: "p 2",
            mrn: "FAKE-002",
            firstName: "Bruno",
            lastName: "Other",
            status: "inactive",
            diagnosis: "Synthetic glioma",
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
    expect(screen.getByRole("link", { name: "Test, Ana" })).toHaveAttribute("href", "/patients/p1");
    expect(screen.getByRole("link", { name: "Other, Bruno" })).toHaveAttribute(
      "href",
      "/patients/p%202",
    );
    expect(screen.getByText("FAKE-002")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toHaveClass("badge", "inactive");
  });
});
