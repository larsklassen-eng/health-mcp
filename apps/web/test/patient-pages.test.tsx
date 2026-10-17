import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiUnavailableError } from "@/lib/api-client";

const { listPatients, getPatient, getChatHistory, notFound } = vi.hoisted(() => ({
  listPatients: vi.fn(),
  getPatient: vi.fn(),
  getChatHistory: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { listPatients, getPatient, getChatHistory },
}));
vi.mock("next/navigation", () => ({ notFound }));

const { default: PatientsPage } = await import("@/app/patients/page");
const { default: PatientPage } = await import("@/app/patients/[id]/page");
const { default: PatientChatPage } = await import("@/app/patients/[id]/chat/page");

beforeEach(() => vi.clearAllMocks());

const patient = {
  id: "p1",
  mrn: "FAKE-001",
  firstName: "Ana",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  sex: "female" as const,
  status: "active" as const,
  diagnosis: "Synthetic meningioma",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

describe("/patients", () => {
  it("lists the patients from the api", async () => {
    listPatients.mockResolvedValueOnce([patient]);
    render(await PatientsPage());

    expect(screen.getByRole("heading", { name: "Patients" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Test, Ana" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New patient" })).toHaveAttribute(
      "href",
      "/patients/new",
    );
  });

  it("explains how to start the api when it is not reachable", async () => {
    listPatients.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));
    render(await PatientsPage());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The api is not reachable at http://api.test",
    );
  });

  it("lets other errors reach the error boundary", async () => {
    listPatients.mockRejectedValueOnce(new Error("schema mismatch"));
    await expect(PatientsPage()).rejects.toThrow("schema mismatch");
  });
});

describe("/patients/[id]", () => {
  const params = Promise.resolve({ id: "p1" });

  it("shows the profile, with a dash for missing optional fields", async () => {
    getPatient.mockResolvedValueOnce(patient);
    render(await PatientPage({ params }));

    expect(screen.getByRole("heading", { name: "Ana Test" })).toBeInTheDocument();
    expect(screen.getByText("Synthetic meningioma")).toBeInTheDocument();
    expect(screen.getByText("Surgery date").nextElementSibling).toHaveTextContent("—");
  });

  it("links to the patient's chat and dashboard", async () => {
    getPatient.mockResolvedValueOnce(patient);
    render(await PatientPage({ params }));

    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/patients/p1/chat");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/patients/p1/dashboard",
    );
  });

  it("renders Next's 404 for an unknown patient", async () => {
    getPatient.mockResolvedValueOnce(null);
    await expect(PatientPage({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("explains when the api is not reachable", async () => {
    getPatient.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));
    render(await PatientPage({ params }));

    expect(screen.getByRole("alert")).toHaveTextContent("The api is not reachable");
  });
});

describe("/patients/[id]/chat", () => {
  const params = Promise.resolve({ id: "p1" });
  const message = (id: string, role: "user" | "assistant", content: string) => ({
    id,
    patientId: "p1",
    role,
    content,
    toolCalls: [],
    createdAt: "2026-10-01T10:00:00.000Z",
  });

  it("shows the patient's chat history", async () => {
    getPatient.mockResolvedValueOnce(patient);
    getChatHistory.mockResolvedValueOnce([
      message("m1", "user", "Any abnormal labs?"),
      message("m2", "assistant", "Hemoglobin is low."),
    ]);
    render(await PatientChatPage({ params }));

    expect(getChatHistory).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("heading", { name: "Chat about Ana Test" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Ana Test" })).toHaveAttribute(
      "href",
      "/patients/p1",
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^You.*Any abnormal labs\?$/),
      expect.stringMatching(/^Assistant.*Hemoglobin is low\.$/),
    ]);
  });

  it("renders Next's 404 for an unknown patient", async () => {
    getPatient.mockResolvedValueOnce(null);
    getChatHistory.mockResolvedValueOnce(null);
    await expect(PatientChatPage({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("explains when the api is not reachable", async () => {
    getPatient.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));
    getChatHistory.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));
    render(await PatientChatPage({ params }));

    expect(screen.getByRole("alert")).toHaveTextContent("The api is not reachable");
  });
});
