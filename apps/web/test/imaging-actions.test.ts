// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

const { updateImagingStudy, deleteImagingStudy, revalidatePath, redirect } = vi.hoisted(() => ({
  updateImagingStudy: vi.fn(),
  deleteImagingStudy: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { updateImagingStudy, deleteImagingStudy },
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const { updateImagingStudyAction, deleteImagingStudyAction } =
  await import("@/app/patients/[id]/imaging/actions");

beforeEach(() => vi.clearAllMocks());

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe("updateImagingStudyAction", () => {
  it("saves the report, clearing emptied fields", async () => {
    updateImagingStudy.mockResolvedValueOnce({});

    const state = await updateImagingStudyAction(
      "p1",
      "s1",
      {},
      form({ description: " MRI brain ", impression: "", report: "Findings: stable." }),
    );

    expect(updateImagingStudy).toHaveBeenCalledWith("p1", "s1", {
      description: "MRI brain",
      impression: null,
      report: "Findings: stable.",
    });
    expect(state).toMatchObject({ saved: true });
    expect(revalidatePath).toHaveBeenCalledWith("/patients/p1/imaging/s1");
  });

  it("keeps what was typed and explains errors", async () => {
    updateImagingStudy.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));

    const state = await updateImagingStudyAction("p1", "s1", {}, form({ report: "Draft" }));

    expect(state.error).toContain("Could not reach the API");
    expect(state.values?.report).toBe("Draft");
  });

  it("rejects a report that is too long without calling the api", async () => {
    const state = await updateImagingStudyAction(
      "p1",
      "s1",
      {},
      form({ report: "x".repeat(20_001) }),
    );

    expect(state.error).toBe("The report is too long.");
    expect(updateImagingStudy).not.toHaveBeenCalled();
  });
});

describe("deleteImagingStudyAction", () => {
  it("deletes the study and goes back to the patient's dashboard", async () => {
    deleteImagingStudy.mockResolvedValueOnce(undefined);

    await expect(deleteImagingStudyAction("p1", "s1", {})).rejects.toThrow(
      "REDIRECT:/patients/p1/dashboard",
    );
    expect(deleteImagingStudy).toHaveBeenCalledWith("p1", "s1");
  });

  it("treats an already deleted study as deleted, and explains other errors", async () => {
    deleteImagingStudy.mockRejectedValueOnce(
      new ApiRequestError(404, { statusCode: 404, error: "x", message: "x" }),
    );
    await expect(deleteImagingStudyAction("p1", "s1", {})).rejects.toThrow("REDIRECT:");

    deleteImagingStudy.mockRejectedValueOnce(new ApiUnavailableError(new Error("down")));
    expect((await deleteImagingStudyAction("p1", "s1", {})).error).toContain("Could not reach");
  });
});
