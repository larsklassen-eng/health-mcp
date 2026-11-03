// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

const { createPatientAccount, resetPatientPassword, removePatientAccount, revalidatePath } =
  vi.hoisted(() => ({
    createPatientAccount: vi.fn(),
    resetPatientPassword: vi.fn(),
    removePatientAccount: vi.fn(),
    revalidatePath: vi.fn(),
  }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { createPatientAccount, resetPatientPassword, removePatientAccount },
}));
vi.mock("next/cache", () => ({ revalidatePath }));

const { patientAccessAction } = await import("@/app/patients/[id]/access-actions");

afterEach(() => vi.clearAllMocks());

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const refused = (status: number, message: string) =>
  new ApiRequestError(status, { statusCode: status, error: "Refused", message });
const account = {
  email: "pat@example.com",
  mustChangePassword: true,
  createdAt: "2026-11-01T10:00:00.000Z",
};
const PASSWORD = "my dog likes blue trains";

describe("patientAccessAction", () => {
  it("creates the account and hands back the details to pass on", async () => {
    createPatientAccount.mockResolvedValueOnce(account);

    const state = await patientAccessAction(
      "p1",
      {},
      form({ intent: "create", email: " pat@example.com ", password: PASSWORD }),
    );

    expect(createPatientAccount).toHaveBeenCalledWith("p1", {
      email: "pat@example.com",
      password: PASSWORD,
    });
    expect(state).toEqual({ issued: { email: "pat@example.com", password: PASSWORD } });
    expect(revalidatePath).toHaveBeenCalledWith("/patients/p1");
  });

  it.each([
    [400, "This is similar to a commonly used password."],
    [409, "An account with this email exists."],
  ])("shows the api's answer to %i, keeping the email", async (status, message) => {
    createPatientAccount.mockRejectedValueOnce(refused(status, message));

    expect(
      await patientAccessAction(
        "p1",
        {},
        form({ intent: "create", email: "pat@example.com", password: PASSWORD }),
      ),
    ).toEqual({ email: "pat@example.com", error: message });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("resets the password", async () => {
    resetPatientPassword.mockResolvedValueOnce(account);

    expect(
      await patientAccessAction("p1", {}, form({ intent: "reset", password: PASSWORD })),
    ).toEqual({ issued: { email: "pat@example.com", password: PASSWORD } });
    expect(resetPatientPassword).toHaveBeenCalledWith("p1", { password: PASSWORD });
  });

  it("removes the account, and treats one already gone as removed", async () => {
    removePatientAccount.mockResolvedValueOnce(undefined);
    expect(await patientAccessAction("p1", {}, form({ intent: "remove" }))).toEqual({});

    removePatientAccount.mockRejectedValueOnce(refused(404, "This patient has no account."));
    expect(await patientAccessAction("p1", {}, form({ intent: "remove" }))).toEqual({});
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("says when the api cannot be reached, and refuses unknown requests", async () => {
    resetPatientPassword.mockRejectedValueOnce(new ApiUnavailableError("down"));

    expect(
      await patientAccessAction("p1", {}, form({ intent: "reset", password: PASSWORD })),
    ).toEqual({ error: "The patient's access could not be changed right now. Try again later." });
    expect(await patientAccessAction("p1", {}, form({ intent: "other" }))).toEqual({
      error: "Unknown request.",
    });
  });
});
