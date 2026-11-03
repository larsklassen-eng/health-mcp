import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteNav } from "@/app/site-nav";

const user = (role: "doctor" | "patient") => ({
  email: "ana@example.com",
  firstName: "Ana",
  lastName: "Test",
  role,
  ...(role === "patient" && { patientId: "p1" }),
  mustChangePassword: false,
});
const links = () => screen.queryAllByRole("link").map((link) => link.getAttribute("href"));

describe("SiteNav", () => {
  it("links doctors (and everyone with sign-in off) to the dashboard and patients", () => {
    render(<SiteNav session={{ mode: "password", user: user("doctor") }} />);
    expect(links()).toEqual(["/dashboard", "/patients"]);
  });

  it("links a patient only to their own record", () => {
    render(<SiteNav session={{ mode: "password", user: user("patient") }} />);
    expect(screen.getByRole("link", { name: "My recovery" })).toHaveAttribute(
      "href",
      "/patients/p1/dashboard",
    );
    expect(links()).toEqual(["/patients/p1/dashboard"]);
  });

  it("shows no links when signed out", () => {
    render(<SiteNav session={{ mode: "password", user: null }} />);
    expect(links()).toEqual([]);
  });
});
