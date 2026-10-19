import type { ImagingStudy } from "@health-mcp/shared";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiUnavailableError } from "@/lib/api-client";

const { getPatient, getImagingStudy, notFound } = vi.hoisted(() => ({
  getPatient: vi.fn(),
  getImagingStudy: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { getPatient, getImagingStudy },
}));
vi.mock("next/navigation", () => ({ notFound, redirect: vi.fn() }));
vi.mock("@/app/patients/[id]/imaging/actions", () => ({
  updateImagingStudyAction: vi.fn(),
  deleteImagingStudyAction: vi.fn(),
}));

const { default: ImagingStudyPage } = await import("@/app/patients/[id]/imaging/[studyId]/page");
const { default: DicomUploadPage } = await import("@/app/patients/[id]/imaging/upload/page");

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

const study: ImagingStudy = {
  id: "s1",
  patientId: "p1",
  modality: "MR",
  bodyPart: "Brain",
  description: "MRI brain with contrast",
  studyDate: "2026-08-18",
  impression: "No residual tumor.",
  report: "Synthetic report. Findings: postoperative changes.",
  source: "dicom",
  series: [{ id: "r1", studyId: "s1", modality: "MR", description: "Ax T1", imageCount: 10 }],
  createdAt: "2026-10-01T10:00:00.000Z",
};

describe("/patients/[id]/imaging/[studyId]", () => {
  const params = Promise.resolve({ id: "p1", studyId: "s1" });

  it("shows the study, its images and its report", async () => {
    getPatient.mockResolvedValueOnce(patient);
    getImagingStudy.mockResolvedValueOnce(study);
    render(await ImagingStudyPage({ params }));

    expect(getImagingStudy).toHaveBeenCalledWith("p1", "s1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("MRI brain, Aug 18, 2026");
    expect(screen.getByText(/1 series, 10 images · uploaded DICOM/)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName("Ax T1, slice 6 of 10");
    expect(screen.getByLabelText("Impression")).toHaveValue("No residual tumor.");
    expect(screen.getByRole("textbox", { name: "Report" })).toHaveValue(study.report);
    expect(screen.getByRole("button", { name: "Delete study" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Ana Test" })).toHaveAttribute(
      "href",
      "/patients/p1/dashboard",
    );
  });

  it("shows an imported study without the image viewer", async () => {
    getPatient.mockResolvedValueOnce(patient);
    getImagingStudy.mockResolvedValueOnce({ ...study, source: "import", series: [] });
    render(await ImagingStudyPage({ params }));

    expect(screen.getByText(/Report only, no images · imported/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Images" })).not.toBeInTheDocument();
  });

  it("renders Next's 404 for an unknown study, and explains an unreachable api", async () => {
    getPatient.mockResolvedValueOnce(patient);
    getImagingStudy.mockResolvedValueOnce(null);
    await expect(ImagingStudyPage({ params })).rejects.toThrow("NOT_FOUND");

    getPatient.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));
    getImagingStudy.mockResolvedValueOnce(study);
    render(await ImagingStudyPage({ params }));
    expect(screen.getByRole("alert")).toHaveTextContent("The api is not reachable");
  });
});

describe("/patients/[id]/imaging/upload", () => {
  it("explains what is kept from the files", async () => {
    getPatient.mockResolvedValueOnce(patient);
    render(await DicomUploadPage({ params: Promise.resolve({ id: "p1" }) }));

    expect(
      screen.getByRole("heading", { name: "Upload DICOM images for Ana Test" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/names, birth dates and IDs inside the files are ignored/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Zip file with DICOM images")).toBeInTheDocument();
  });
});
