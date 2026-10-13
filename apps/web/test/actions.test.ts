// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

const { createPatient, importPatients, revalidatePath, redirect } = vi.hoisted(() => ({
  createPatient: vi.fn(),
  importPatients: vi.fn(),
  revalidatePath: vi.fn(),
  // Next's redirect() throws to stop rendering; mimic that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { createPatient, importPatients },
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const { createPatientAction, importPatientsAction } = await import("@/app/patients/actions");

beforeEach(() => vi.clearAllMocks());

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const validFields = {
  mrn: " FAKE-001 ",
  firstName: "Ana",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  sex: "female",
  status: "active",
  diagnosis: "Synthetic meningioma",
  surgeryDate: "",
  notes: "",
};

describe("createPatientAction", () => {
  it("creates the patient and redirects to it", async () => {
    createPatient.mockResolvedValueOnce({ id: "p1" });

    await expect(createPatientAction({}, form(validFields))).rejects.toThrow("REDIRECT:/patients/p1");

    expect(createPatient).toHaveBeenCalledWith({
      mrn: "FAKE-001",
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      status: "active",
      diagnosis: "Synthetic meningioma",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/patients");
  });

  it("returns one error per invalid field and keeps what was typed", async () => {
    const state = await createPatientAction({}, form({ ...validFields, mrn: "", sex: "", dateOfBirth: "01/01/1980" }));

    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual(["dateOfBirth", "mrn", "sex"]);
    expect(state.values?.dateOfBirth).toBe("01/01/1980");
    expect(createPatient).not.toHaveBeenCalled();
  });

  it("shows a duplicate MRN on the MRN field", async () => {
    createPatient.mockRejectedValueOnce(new ApiRequestError(409, { statusCode: 409, error: "Conflict", message: "exists" }));

    const state = await createPatientAction({}, form(validFields));

    expect(state.fieldErrors?.mrn).toBe("A patient with this MRN already exists");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("explains when the api is not reachable", async () => {
    createPatient.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));

    const state = await createPatientAction({}, form(validFields));

    expect(state.formError).toContain("Could not reach the API");
    expect(state.values?.firstName).toBe("Ana");
  });
});

const jsonFile = (content: unknown, name = "patients.json") =>
  new File([typeof content === "string" ? content : JSON.stringify(content)], name, { type: "application/json" });

const validImport = {
  version: 1,
  patients: [{ patient: { mrn: "FAKE-1", firstName: "A", lastName: "B", dateOfBirth: "1980-01-01", sex: "male", diagnosis: "x" } }],
};

describe("importPatientsAction", () => {
  it("imports a valid file and returns the result", async () => {
    importPatients.mockResolvedValueOnce({ imported: [{ patientId: "p1", mrn: "FAKE-1", records: 0 }] });

    const state = await importPatientsAction({}, form({ file: jsonFile(validImport) }));

    expect(state.result?.imported).toHaveLength(1);
    expect(importPatients).toHaveBeenCalledWith(validImport);
    expect(revalidatePath).toHaveBeenCalledWith("/patients");
  });

  it.each([
    ["no file", {}, "Choose a JSON file"],
    ["an empty file", { file: jsonFile("") }, "Choose a JSON file"],
    ["invalid JSON", { file: jsonFile("{ not json") }, "not valid JSON"],
  ])("rejects %s without calling the api", async (_label, fields, message) => {
    const state = await importPatientsAction({}, form(fields as Record<string, File>));

    expect(state.formError).toContain(message);
    expect(importPatients).not.toHaveBeenCalled();
  });

  it("lists schema problems with their path, capped at 20", async () => {
    const patients = Array.from({ length: 30 }, () => ({ patient: { mrn: "" } }));
    const state = await importPatientsAction({}, form({ file: jsonFile({ version: 1, patients }) }));

    expect(state.errors?.[0]).toMatch(/^patients\.0\.patient\.mrn: /);
    expect(state.errors).toHaveLength(21);
    expect(state.errors?.at(-1)).toMatch(/^…and \d+ more$/);
    expect(importPatients).not.toHaveBeenCalled();
  });

  it("reports a duplicate MRN from the api", async () => {
    importPatients.mockRejectedValueOnce(
      new ApiRequestError(409, { statusCode: 409, error: "Conflict", message: "A patient with MRN FAKE-1 already exists" }),
    );

    const state = await importPatientsAction({}, form({ file: jsonFile(validImport) }));

    expect(state.formError).toBe("Nothing was imported: A patient with MRN FAKE-1 already exists");
  });
});
