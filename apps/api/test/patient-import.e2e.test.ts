import { labResults, medications, recoveryMilestones, symptoms, vitalSigns } from "@health-mcp/db";
import {
  ApiErrorSchema,
  type PatientImportFile,
  PatientImportResultSchema,
} from "@health-mcp/shared";
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

const importFile = (body: unknown) => testApp.request("POST", "/patients/import", body);
const db = () => testApp.app.get(DatabaseService).db;
const patientCount = async () =>
  ((await testApp.request("GET", "/patients")).body as { patients: unknown[] }).patients.length;

const fullBundle = {
  patient: newPatient({ mrn: "FAKE-100" }),
  labResults: [
    {
      testName: "Hemoglobin",
      value: 11.2,
      unit: "g/dL",
      flag: "low",
      collectedAt: "2026-09-10T08:00:00-05:00",
    },
  ],
  vitals: [{ type: "pain_score", value: 3, unit: "", recordedAt: "2026-09-10T09:00:00Z" }],
  medications: [
    {
      name: "Dexamethasone",
      dosage: "4 mg",
      frequency: "twice daily",
      status: "active",
      startDate: "2026-09-01",
    },
  ],
  symptoms: [{ name: "headache", severity: 4, recordedAt: "2026-09-10T10:30:00+02:00" }],
  milestones: [
    { title: "Walk 100 m unaided", status: "achieved", achievedAt: "2026-09-20T15:00:00-03:00" },
  ],
} satisfies PatientImportFile["patients"][number];

describe("POST /patients/import", () => {
  it("imports patients with all of their records", async () => {
    const file: PatientImportFile = {
      version: 1,
      patients: [fullBundle, { patient: newPatient({ mrn: "FAKE-200", lastName: "Second" }) }],
    };

    const { status, body } = await importFile(file);

    expect(status).toBe(201);
    const { imported } = PatientImportResultSchema.parse(body);
    expect(imported.map(({ mrn, records }) => ({ mrn, records }))).toEqual([
      { mrn: "FAKE-100", records: 5 },
      { mrn: "FAKE-200", records: 0 },
    ]);
    expect(await patientCount()).toBe(2);

    const [lab] = db().select().from(labResults).all();
    expect(lab).toMatchObject({
      patientId: imported[0]!.patientId,
      testName: "Hemoglobin",
      flag: "low",
    });
    expect(db().select().from(vitalSigns).all()).toHaveLength(1);
    expect(db().select().from(medications).all()).toHaveLength(1);
  });

  it("stores every timestamp in UTC", async () => {
    await importFile({ version: 1, patients: [fullBundle] });

    expect(db().select().from(labResults).get()?.collectedAt).toBe("2026-09-10T13:00:00.000Z");
    expect(db().select().from(symptoms).get()?.recordedAt).toBe("2026-09-10T08:30:00.000Z");
    expect(db().select().from(recoveryMilestones).get()?.achievedAt).toBe(
      "2026-09-20T18:00:00.000Z",
    );
  });

  it("returns 409 and saves nothing when the file repeats an MRN", async () => {
    const file = {
      version: 1,
      patients: [fullBundle, { patient: newPatient({ mrn: "FAKE-100" }) }],
    };

    const { status, body } = await importFile(file);

    expect(status).toBe(409);
    expect(ApiErrorSchema.parse(body).message).toContain("FAKE-100");
    expect(await patientCount()).toBe(0);
  });

  it("returns 409 and rolls back earlier patients when an MRN already exists", async () => {
    await testApp.request("POST", "/patients", newPatient({ mrn: "FAKE-EXISTING" }));
    const file = {
      version: 1,
      patients: [fullBundle, { patient: newPatient({ mrn: "FAKE-EXISTING" }) }],
    };

    const { status, body } = await importFile(file);

    expect(status).toBe(409);
    expect(ApiErrorSchema.parse(body).message).toContain("FAKE-EXISTING");
    expect(await patientCount()).toBe(1);
    expect(db().select().from(labResults).all()).toEqual([]);
  });

  it("returns 400 pointing at the invalid record", async () => {
    const file = {
      version: 1,
      patients: [{ ...fullBundle, labResults: [{ ...fullBundle.labResults[0], flag: "weird" }] }],
    };

    const { status, body } = await importFile(file);

    expect(status).toBe(400);
    const paths = (ApiErrorSchema.parse(body).details as { path: string }[]).map(
      (issue) => issue.path,
    );
    expect(paths).toContain("patients.0.labResults.0.flag");
    expect(await patientCount()).toBe(0);
  });

  it("rejects an unsupported file version", async () => {
    const { status } = await importFile({ version: 2, patients: [fullBundle] });
    expect(status).toBe(400);
  });

  it("accepts files larger than Express's default 100 KB limit", async () => {
    const vitals = Array.from({ length: 2000 }, (_, i) => ({
      type: "heart_rate",
      value: 60 + (i % 40),
      unit: "bpm",
      recordedAt: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
    }));
    const file = { version: 1, patients: [{ patient: newPatient(), vitals }] };
    expect(JSON.stringify(file).length).toBeGreaterThan(100_000);

    const { status, body } = await importFile(file);

    expect(status).toBe(201);
    expect(PatientImportResultSchema.parse(body).imported[0]?.records).toBe(2000);
  });
});
