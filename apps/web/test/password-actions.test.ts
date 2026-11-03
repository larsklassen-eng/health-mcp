// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api-client";

const { changePasswordWithApi, store, redirect } = vi.hoisted(() => ({
  changePasswordWithApi: vi.fn(),
  store: { set: vi.fn() },
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { changePassword: changePasswordWithApi },
}));
vi.mock("next/headers", () => ({ cookies: async () => store }));
vi.mock("next/navigation", () => ({ redirect }));

const { changePassword } = await import("@/app/account/password/actions");

afterEach(() => vi.clearAllMocks());

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const fields = {
  currentPassword: "my dog likes blue trains",
  newPassword: "violet-tram-orbit-91",
  repeatPassword: "violet-tram-orbit-91",
};
const changed = (role: "doctor" | "patient") => ({
  session: "new-session",
  user: {
    email: "pat@example.com",
    firstName: "Pat",
    lastName: "Test",
    role,
    ...(role === "patient" && { patientId: "p1" }),
    mustChangePassword: false,
  },
  expiresAt: "2026-11-04T00:00:00.000Z",
});

describe("changePassword", () => {
  it("keeps the new session and opens the patient's own dashboard", async () => {
    changePasswordWithApi.mockResolvedValueOnce(changed("patient"));

    await expect(changePassword({}, form(fields))).rejects.toThrow(
      "NEXT_REDIRECT /patients/p1/dashboard",
    );

    expect(changePasswordWithApi).toHaveBeenCalledWith({
      currentPassword: fields.currentPassword,
      newPassword: fields.newPassword,
    });
    expect(store.set).toHaveBeenCalledWith(
      "hm_session",
      "new-session",
      expect.objectContaining({ httpOnly: true, expires: new Date("2026-11-04T00:00:00.000Z") }),
    );
  });

  it("opens the patients list for a doctor", async () => {
    changePasswordWithApi.mockResolvedValueOnce(changed("doctor"));

    await expect(changePassword({}, form(fields))).rejects.toThrow("NEXT_REDIRECT /patients");
  });

  it("refuses new passwords that differ, without calling the api", async () => {
    expect(await changePassword({}, form({ ...fields, repeatPassword: "other" }))).toEqual({
      error: "The new passwords do not match.",
    });
    expect(changePasswordWithApi).not.toHaveBeenCalled();
  });

  it.each([
    [400, "The current password is incorrect."],
    [429, "Too many failed attempts. Try again in 15 minutes."],
  ])("shows the api's answer to %i", async (status, message) => {
    changePasswordWithApi.mockRejectedValueOnce(
      new ApiRequestError(status, { statusCode: status, error: "Refused", message }),
    );

    expect(await changePassword({}, form(fields))).toEqual({ error: message });
    expect(store.set).not.toHaveBeenCalled();
  });
});
