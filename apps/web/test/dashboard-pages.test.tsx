import type { DashboardOverview, PatientDashboard } from "@health-mcp/shared";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiUnavailableError } from "@/lib/api-client";

const { getDashboardOverview, getPatientDashboard, notFound } = vi.hoisted(() => ({
  getDashboardOverview: vi.fn(),
  getPatientDashboard: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { getDashboardOverview, getPatientDashboard },
}));
vi.mock("next/navigation", () => ({ notFound }));

const { default: DashboardPage } = await import("@/app/dashboard/page");
const { default: PatientDashboardPage } = await import("@/app/patients/[id]/dashboard/page");

beforeEach(() => vi.clearAllMocks());

const row = {
  patientId: "p1",
  name: "Ana Test",
  mrn: "FAKE-001",
  status: "active" as const,
  lastActivityAt: "2026-10-12T08:00:00.000Z",
  abnormalLabCount: 2,
  activeMedicationCount: 3,
  latestPainScore: 4,
  milestonesAchieved: 1,
  milestonesTotal: 4,
};

const overview: DashboardOverview = {
  totalPatients: 2,
  activePatients: 1,
  abnormalLabsLast7Days: 5,
  patients: [
    row,
    {
      ...row,
      patientId: "p2",
      name: "Ben Quiet",
      mrn: "FAKE-002",
      status: "inactive",
      lastActivityAt: null,
      abnormalLabCount: 0,
      activeMedicationCount: 0,
      latestPainScore: null,
      milestonesAchieved: 0,
      milestonesTotal: 0,
    },
  ],
};

const statValue = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("/dashboard", () => {
  it("shows the totals and a row per patient", async () => {
    getDashboardOverview.mockResolvedValueOnce(overview);
    render(await DashboardPage());

    expect(statValue("Patients")).toBe("2");
    expect(statValue("Active patients")).toBe("1");
    expect(statValue("Abnormal labs, last 7 days")).toBe("5");

    const [, ana, ben] = screen.getAllByRole("row");
    expect(within(ana!).getByRole("link", { name: "Ana Test" })).toHaveAttribute(
      "href",
      "/patients/p1/dashboard",
    );
    expect(ana).toHaveTextContent("Oct 12, 2026");
    expect(ana).toHaveTextContent("4/10");
    expect(
      within(ana!).getByRole("progressbar", { name: "1 of 4 milestones achieved" }),
    ).toHaveAttribute("value", "1");
    expect(within(ben!).getAllByText("—")).toHaveLength(3); // last activity, pain, milestones
    expect(within(ben!).getByText("inactive")).toBeInTheDocument();
  });

  it("explains how to add patients when there are none", async () => {
    getDashboardOverview.mockResolvedValueOnce({ ...overview, totalPatients: 0, patients: [] });
    render(await DashboardPage());

    expect(screen.getByText("No patients yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("explains when the api is not reachable", async () => {
    getDashboardOverview.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));
    render(await DashboardPage());

    expect(screen.getByRole("alert")).toHaveTextContent("The api is not reachable");
  });
});

const patient = {
  id: "p1",
  mrn: "FAKE-001",
  firstName: "Ana",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  sex: "female" as const,
  status: "active" as const,
  diagnosis: "Synthetic meningioma",
  surgeryDate: "2026-08-16",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

const dashboard: PatientDashboard = {
  patient,
  latestVitals: [
    {
      id: "v2",
      patientId: "p1",
      type: "heart_rate",
      value: 72,
      unit: "bpm",
      recordedAt: "2026-10-03T08:00:00.000Z",
    },
  ],
  vitalTrends: [
    {
      type: "heart_rate",
      unit: "bpm",
      points: [
        { recordedAt: "2026-10-01T08:00:00.000Z", value: 80 },
        { recordedAt: "2026-10-03T08:00:00.000Z", value: 72 },
      ],
    },
  ],
  recentLabs: [
    {
      id: "l1",
      patientId: "p1",
      testName: "Hemoglobin",
      value: 11.2,
      unit: "g/dL",
      referenceLow: 12,
      referenceHigh: 15.5,
      flag: "low",
      collectedAt: "2026-10-02T08:00:00.000Z",
    },
    {
      id: "l2",
      patientId: "p1",
      testName: "Sodium",
      value: 140,
      unit: "mmol/L",
      collectedAt: "2026-10-02T08:00:00.000Z",
    },
  ],
  activeMedications: [
    {
      id: "m1",
      patientId: "p1",
      name: "Levetiracetam",
      dosage: "500 mg",
      frequency: "twice daily",
      route: "oral",
      status: "active",
      startDate: "2026-08-10",
    },
  ],
  recentSymptoms: [
    {
      id: "s1",
      patientId: "p1",
      name: "Headache",
      severity: 3,
      notes: "Mild, in the morning",
      recordedAt: "2026-10-04T07:00:00.000Z",
    },
  ],
  milestones: [
    {
      id: "r1",
      patientId: "p1",
      title: "Walk 1 km",
      status: "achieved",
      targetDate: "2026-09-15",
      achievedAt: "2026-09-10T10:00:00.000Z",
    },
    { id: "r2", patientId: "p1", title: "Drive again", status: "pending" },
  ],
  imagingStudies: [
    {
      id: "i1",
      patientId: "p1",
      modality: "MR",
      bodyPart: "Brain",
      description: "MRI brain with contrast",
      studyDate: "2026-09-08",
      impression: "Stable disease.",
      source: "dicom",
      series: [
        { id: "r1", studyId: "i1", modality: "MR", imageCount: 176 },
        { id: "r2", studyId: "i1", modality: "MR", imageCount: 24 },
      ],
      createdAt: "2026-10-01T10:00:00.000Z",
    },
    {
      id: "i2",
      patientId: "p1",
      modality: "CR",
      studyDate: "2026-08-06",
      source: "import",
      series: [],
      createdAt: "2026-10-01T10:00:00.000Z",
    },
  ],
};

describe("/patients/[id]/dashboard", () => {
  const params = Promise.resolve({ id: "p1" });
  const section = (name: string) => screen.getByRole("region", { name });

  it("shows the patient's header and links", async () => {
    getPatientDashboard.mockResolvedValueOnce(dashboard);
    render(await PatientDashboardPage({ params }));

    expect(getPatientDashboard).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("heading", { level: 1, name: "Ana Test" })).toBeInTheDocument();
    expect(screen.getByText(/Surgery Aug 16, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/patients/p1");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/patients/p1/chat");
  });

  it("shows each vital's latest value with its trend", async () => {
    getPatientDashboard.mockResolvedValueOnce(dashboard);
    render(await PatientDashboardPage({ params }));

    const vitals = section("Vitals");
    expect(vitals).toHaveTextContent("Heart rate");
    expect(vitals).toHaveTextContent("72 bpm");
    expect(within(vitals).getByRole("img")).toHaveAccessibleName(
      "2 readings from Oct 1, 2026 to Oct 3, 2026, between 72 and 80 bpm",
    );
  });

  it("highlights abnormal labs and shows reference ranges", async () => {
    getPatientDashboard.mockResolvedValueOnce(dashboard);
    render(await PatientDashboardPage({ params }));

    const [, hemoglobin, sodium] = within(section("Labs")).getAllByRole("row");
    expect(hemoglobin).toHaveClass("abnormal");
    expect(hemoglobin).toHaveTextContent("11.2 g/dL");
    expect(hemoglobin).toHaveTextContent("12–15.5");
    expect(within(hemoglobin!).getByText("low")).toHaveClass("badge", "flag-low");
    expect(sodium).not.toHaveClass("abnormal");
  });

  it("lists medications, symptoms and milestones", async () => {
    getPatientDashboard.mockResolvedValueOnce(dashboard);
    render(await PatientDashboardPage({ params }));

    expect(section("Active medications")).toHaveTextContent(
      "Levetiracetam 500 mg, twice daily (oral)",
    );
    expect(section("Recent symptoms")).toHaveTextContent("Headache severity 3/10");
    // Passages from the chat's record search link to it.
    expect(within(section("Recent symptoms")).getByRole("listitem")).toHaveAttribute(
      "id",
      "symptom-s1",
    );
    const [walk, drive] = within(section("Recovery milestones")).getAllByRole("listitem");
    expect(walk).toHaveTextContent("Achieved Sep 10, 2026");
    expect(drive).toHaveTextContent("No target date");
  });

  it("lists imaging studies with links, and links to the upload", async () => {
    getPatientDashboard.mockResolvedValueOnce(dashboard);
    render(await PatientDashboardPage({ params }));

    const [mri, xray] = within(section("Imaging")).getAllByRole("listitem");
    expect(within(mri!).getByRole("link", { name: "MRI brain" })).toHaveAttribute(
      "href",
      "/patients/p1/imaging/i1",
    );
    expect(mri).toHaveTextContent("Sep 8, 2026 · MRI brain with contrast");
    expect(mri).toHaveTextContent("Stable disease.");
    expect(mri).toHaveTextContent("2 series, 200 images");
    expect(xray).toHaveTextContent("X-ray");
    expect(xray).toHaveTextContent("Report only, no images");
    expect(screen.getByRole("link", { name: "Upload DICOM images" })).toHaveAttribute(
      "href",
      "/patients/p1/imaging/upload",
    );
  });

  it("explains empty sections", async () => {
    getPatientDashboard.mockResolvedValueOnce({
      ...dashboard,
      latestVitals: [],
      vitalTrends: [],
      recentLabs: [],
      activeMedications: [],
      recentSymptoms: [],
      milestones: [],
      imagingStudies: [],
    });
    render(await PatientDashboardPage({ params }));

    expect(section("Vitals")).toHaveTextContent("No vitals recorded.");
    expect(section("Labs")).toHaveTextContent("No lab results.");
    expect(section("Recovery milestones")).toHaveTextContent("No milestones.");
    expect(section("Imaging")).toHaveTextContent("No imaging studies.");
  });

  it("renders Next's 404 for an unknown patient", async () => {
    getPatientDashboard.mockResolvedValueOnce(null);
    await expect(PatientDashboardPage({ params })).rejects.toThrow("NOT_FOUND");
  });

  it("explains when the api is not reachable", async () => {
    getPatientDashboard.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));
    render(await PatientDashboardPage({ params }));

    expect(screen.getByRole("alert")).toHaveTextContent("The api is not reachable");
  });
});
