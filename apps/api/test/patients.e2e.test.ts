import { labResults } from "@health-mcp/db";
import { ApiErrorSchema, type Patient, PatientListResponseSchema, PatientSchema } from "@health-mcp/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { DatabaseService } from "../src/database/database.service.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
beforeEach(async () => {
  testApp = await startTestApp(AppModule);
});
afterEach(async () => {
  await testApp.close();
});

async function createPatient(overrides = {}): Promise<Patient> {
  const { status, body } = await testApp.request("POST", "/patients", newPatient(overrides));
  expect(status).toBe(201);
  return PatientSchema.parse(body);
}

describe("POST /patients", () => {
  it("creates a patient with server-generated fields and defaults", async () => {
    const patient = await createPatient();

    expect(patient).toMatchObject({ mrn: "FAKE-001", status: "active" });
    expect(patient.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(patient.createdAt).toBe(patient.updatedAt);
  });

  it("omits optional fields that were not provided instead of returning null", async () => {
    const { body } = await testApp.request("POST", "/patients", newPatient());

    expect(body).not.toHaveProperty("notes");
    expect(body).not.toHaveProperty("surgeryDate");
  });

  it("returns 400 listing each invalid field", async () => {
    const { status, body } = await testApp.request("POST", "/patients", { mrn: "", sex: "robot" });

    expect(status).toBe(400);
    const paths = (ApiErrorSchema.parse(body).details as { path: string }[]).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(["mrn", "sex", "firstName", "dateOfBirth"]));
  });

  it("returns 409 for a duplicate MRN", async () => {
    await createPatient();
    const { status, body } = await testApp.request("POST", "/patients", newPatient({ firstName: "Other" }));

    expect(status).toBe(409);
    expect(ApiErrorSchema.parse(body).message).toContain("FAKE-001");
  });
});

describe("GET /patients", () => {
  it("returns an empty list when there are no patients", async () => {
    const { status, body } = await testApp.request("GET", "/patients");

    expect(status).toBe(200);
    expect(body).toEqual({ patients: [] });
  });

  it("returns summaries sorted by last name, then first name", async () => {
    await createPatient({ mrn: "FAKE-1", lastName: "Zeta", firstName: "Ana" });
    await createPatient({ mrn: "FAKE-2", lastName: "Alpha", firstName: "Bruno" });
    await createPatient({ mrn: "FAKE-3", lastName: "Alpha", firstName: "Ada" });

    const { body } = await testApp.request("GET", "/patients");
    const { patients } = PatientListResponseSchema.parse(body);

    expect(patients.map((p) => `${p.lastName}, ${p.firstName}`)).toEqual(["Alpha, Ada", "Alpha, Bruno", "Zeta, Ana"]);
    expect(Object.keys(patients[0]!).sort()).toEqual(["diagnosis", "firstName", "id", "lastName", "mrn", "status"]);
  });
});

describe("GET /patients/:id", () => {
  it("returns the full patient", async () => {
    const created = await createPatient({ notes: "Synthetic notes", surgeryDate: "2026-09-01" });
    const { status, body } = await testApp.request("GET", `/patients/${created.id}`);

    expect(status).toBe(200);
    expect(PatientSchema.parse(body)).toEqual(created);
  });

  it("returns 404 for an unknown id", async () => {
    const { status, body } = await testApp.request("GET", "/patients/does-not-exist");

    expect(status).toBe(404);
    expect(ApiErrorSchema.parse(body).statusCode).toBe(404);
  });

  it("returns 400 for an id that is too long", async () => {
    const { status } = await testApp.request("GET", `/patients/${"x".repeat(65)}`);
    expect(status).toBe(400);
  });
});

describe("PATCH /patients/:id", () => {
  it("updates only the given fields and refreshes updatedAt", async () => {
    const created = await createPatient({ status: "inactive" });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const { status, body } = await testApp.request("PATCH", `/patients/${created.id}`, { notes: "Walking unaided" });
    const updated = PatientSchema.parse(body);

    expect(status).toBe(200);
    expect(updated.notes).toBe("Walking unaided");
    expect(updated.status).toBe("inactive"); // omitted fields are not reset to defaults
    expect(updated.firstName).toBe(created.firstName);
    expect(updated.updatedAt > created.updatedAt).toBe(true);
  });

  it("returns the patient unchanged for an empty body", async () => {
    const created = await createPatient();
    const { status, body } = await testApp.request("PATCH", `/patients/${created.id}`, {});

    expect(status).toBe(200);
    expect(body).toEqual(created);
  });

  it("returns 400 for invalid fields", async () => {
    const created = await createPatient();
    const { status } = await testApp.request("PATCH", `/patients/${created.id}`, { status: "archived" });
    expect(status).toBe(400);
  });

  it("returns 409 when changing to an MRN that is taken", async () => {
    await createPatient({ mrn: "FAKE-1" });
    const second = await createPatient({ mrn: "FAKE-2" });

    const { status } = await testApp.request("PATCH", `/patients/${second.id}`, { mrn: "FAKE-1" });
    expect(status).toBe(409);
  });

  it("returns 404 for an unknown id", async () => {
    const { status } = await testApp.request("PATCH", "/patients/does-not-exist", { notes: "x" });
    expect(status).toBe(404);
  });
});

describe("DELETE /patients/:id", () => {
  it("deletes the patient and all of their records", async () => {
    const patient = await createPatient();
    const db = testApp.app.get(DatabaseService).db;
    db.insert(labResults)
      .values({ patientId: patient.id, testName: "Hb", value: 12, unit: "g/dL", collectedAt: "2026-09-10T13:00:00.000Z" })
      .run();

    const { status, body } = await testApp.request("DELETE", `/patients/${patient.id}`);

    expect(status).toBe(204);
    expect(body).toBeUndefined();
    expect((await testApp.request("GET", `/patients/${patient.id}`)).status).toBe(404);
    expect(db.select().from(labResults).all()).toEqual([]);
  });

  it("returns 404 for an unknown id", async () => {
    const { status } = await testApp.request("DELETE", "/patients/does-not-exist");
    expect(status).toBe(404);
  });
});
