import {
  type HealthDb,
  labResults,
  medications,
  patients,
  recoveryMilestones,
  symptoms,
  vitalSigns,
} from "@health-mcp/db";
import {
  ApiErrorSchema,
  type CreatePatientInput,
  DashboardOverviewSchema,
  MAX_RECENT_SYMPTOMS,
  MAX_TREND_POINTS,
  PatientDashboardSchema,
} from "@health-mcp/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { DashboardsService } from "../src/dashboards/dashboards.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
let db: HealthDb;
beforeEach(async () => {
  testApp = await startTestApp(AppModule);
  db = testApp.app.get(DatabaseService).db;
});
afterEach(async () => {
  await testApp.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const insertPatient = (overrides: Partial<CreatePatientInput> = {}) =>
  db.insert(patients).values(newPatient(overrides)).returning().get().id;

const lab = (
  patientId: string,
  testName: string,
  collectedAt: string,
  flag?: "low" | "normal" | "high" | "critical",
) =>
  db
    .insert(labResults)
    .values({ patientId, testName, value: 1, unit: "u", collectedAt, ...(flag && { flag }) })
    .run();

const vital = (
  patientId: string,
  type: "heart_rate" | "pain_score" | "weight",
  value: number,
  recordedAt: string,
) =>
  db
    .insert(vitalSigns)
    .values({ patientId, type, value, unit: type === "heart_rate" ? "bpm" : "u", recordedAt })
    .run();

const getOverview = async () => {
  const { status, body } = await testApp.request("GET", "/dashboards/overview");
  expect(status).toBe(200);
  return DashboardOverviewSchema.parse(body);
};

const getPatientDashboard = async (id: string) => {
  const { status, body } = await testApp.request("GET", `/dashboards/patients/${id}`);
  expect(status).toBe(200);
  return PatientDashboardSchema.parse(body);
};

describe("GET /dashboards/overview", () => {
  it("is empty without patients", async () => {
    expect(await getOverview()).toEqual({
      totalPatients: 0,
      activePatients: 0,
      abnormalLabsLast7Days: 0,
      patients: [],
    });
  });

  it("summarizes each patient, sorted by last name", async () => {
    const zed = insertPatient({
      mrn: "FAKE-Z",
      firstName: "Zoe",
      lastName: "Zed",
      status: "inactive",
    });
    const ana = insertPatient({ mrn: "FAKE-A", firstName: "Ana", lastName: "Able" });

    // Hemoglobin was low but its latest result is normal; Sodium's latest is high.
    lab(ana, "Hemoglobin", daysAgo(20), "low");
    lab(ana, "Hemoglobin", daysAgo(10), "normal");
    lab(ana, "Sodium", daysAgo(10), "high");
    lab(ana, "Platelets", daysAgo(9));
    vital(ana, "pain_score", 6, daysAgo(5));
    vital(ana, "pain_score", 3, daysAgo(2));
    db.insert(medications)
      .values([
        {
          patientId: ana,
          name: "A",
          dosage: "1",
          frequency: "daily",
          status: "active",
          startDate: "2026-01-01",
        },
        {
          patientId: ana,
          name: "B",
          dosage: "1",
          frequency: "daily",
          status: "stopped",
          startDate: "2026-01-01",
        },
      ])
      .run();
    const achievedAt = daysAgo(1);
    db.insert(recoveryMilestones)
      .values([
        { patientId: ana, title: "Walk", status: "achieved", achievedAt },
        { patientId: ana, title: "Drive" },
      ])
      .run();

    const overview = await getOverview();

    expect(overview).toMatchObject({ totalPatients: 2, activePatients: 1 });
    expect(overview.patients).toEqual([
      {
        patientId: ana,
        name: "Ana Able",
        mrn: "FAKE-A",
        status: "active",
        lastActivityAt: achievedAt,
        abnormalLabCount: 1,
        activeMedicationCount: 1,
        latestPainScore: 3,
        milestonesAchieved: 1,
        milestonesTotal: 2,
      },
      {
        patientId: zed,
        name: "Zoe Zed",
        mrn: "FAKE-Z",
        status: "inactive",
        lastActivityAt: null,
        abnormalLabCount: 0,
        activeMedicationCount: 0,
        latestPainScore: null,
        milestonesAchieved: 0,
        milestonesTotal: 0,
      },
    ]);
  });

  it("takes last activity from labs, vitals, symptoms and achieved milestones", async () => {
    const id = insertPatient();
    lab(id, "Sodium", daysAgo(4));
    vital(id, "heart_rate", 70, daysAgo(3));
    const latest = daysAgo(2);
    db.insert(symptoms)
      .values({ patientId: id, name: "Headache", severity: 3, recordedAt: latest })
      .run();
    db.insert(recoveryMilestones)
      .values({ patientId: id, title: "Pending", targetDate: "2099-01-01" })
      .run();

    expect((await getOverview()).patients[0]?.lastActivityAt).toBe(latest);
  });

  it("counts abnormal labs collected in the last 7 days across all patients", async () => {
    const a = insertPatient({ mrn: "FAKE-A" });
    const b = insertPatient({ mrn: "FAKE-B" });
    const now = new Date("2026-10-17T12:00:00.000Z");
    lab(a, "Sodium", "2026-10-10T12:00:00.000Z", "high"); // exactly 7 days before
    lab(a, "Sodium", "2026-10-10T11:59:59.000Z", "critical"); // just outside
    lab(a, "Potassium", "2026-10-16T08:00:00.000Z", "normal");
    lab(b, "Hemoglobin", "2026-10-15T08:00:00.000Z", "low");
    lab(b, "Hemoglobin", "2026-10-16T08:00:00.000Z", "critical");

    const overview = testApp.app.get(DashboardsService).overview(now);

    expect(overview.abnormalLabsLast7Days).toBe(3);
  });
});

describe("GET /dashboards/patients/:id", () => {
  it("returns the patient with empty sections when there are no records", async () => {
    const id = insertPatient({ surgeryDate: "2026-08-16" });

    const dashboard = await getPatientDashboard(id);

    expect(dashboard.patient).toMatchObject({ id, mrn: "FAKE-001", surgeryDate: "2026-08-16" });
    expect(dashboard).toMatchObject({
      latestVitals: [],
      vitalTrends: [],
      recentLabs: [],
      activeMedications: [],
      recentSymptoms: [],
      milestones: [],
    });
  });

  it("returns the latest reading and a trend per vital type, in shared order", async () => {
    const id = insertPatient();
    vital(id, "weight", 70, "2026-10-01T08:00:00.000Z");
    vital(id, "heart_rate", 80, "2026-10-01T08:00:00.000Z");
    vital(id, "heart_rate", 72, "2026-10-03T08:00:00.000Z");
    vital(id, "heart_rate", 76, "2026-10-02T08:00:00.000Z");

    const { latestVitals, vitalTrends } = await getPatientDashboard(id);

    expect(latestVitals.map((v) => [v.type, v.value])).toEqual([
      ["heart_rate", 72],
      ["weight", 70],
    ]);
    expect(vitalTrends[0]).toEqual({
      type: "heart_rate",
      unit: "bpm",
      points: [
        { recordedAt: "2026-10-01T08:00:00.000Z", value: 80 },
        { recordedAt: "2026-10-02T08:00:00.000Z", value: 76 },
        { recordedAt: "2026-10-03T08:00:00.000Z", value: 72 },
      ],
    });
    expect(vitalTrends.map((t) => t.type)).toEqual(["heart_rate", "weight"]);
  });

  it(`keeps the latest ${MAX_TREND_POINTS} readings in a trend`, async () => {
    const id = insertPatient();
    for (let i = 0; i < MAX_TREND_POINTS + 5; i++)
      vital(id, "heart_rate", i, new Date(Date.UTC(2026, 6, 1) + i * DAY_MS).toISOString());

    const [trend] = (await getPatientDashboard(id)).vitalTrends;

    expect(trend?.points).toHaveLength(MAX_TREND_POINTS);
    expect(trend?.points[0]?.value).toBe(5);
    expect(trend?.points.at(-1)?.value).toBe(MAX_TREND_POINTS + 4);
  });

  it("returns the latest result of each test, by test name", async () => {
    const id = insertPatient();
    lab(id, "Sodium", "2026-10-01T08:00:00.000Z", "high");
    lab(id, "Sodium", "2026-10-05T08:00:00.000Z", "normal");
    lab(id, "Albumin", "2026-09-01T08:00:00.000Z");

    const { recentLabs } = await getPatientDashboard(id);

    expect(recentLabs.map((l) => [l.testName, l.collectedAt, l.flag])).toEqual([
      ["Albumin", "2026-09-01T08:00:00.000Z", undefined],
      ["Sodium", "2026-10-05T08:00:00.000Z", "normal"],
    ]);
    expect(recentLabs[0]).not.toHaveProperty("flag");
  });

  it("returns active medications, recent symptoms and ordered milestones", async () => {
    const id = insertPatient();
    db.insert(medications)
      .values([
        {
          patientId: id,
          name: "Old",
          dosage: "1",
          frequency: "daily",
          status: "active",
          startDate: "2026-01-01",
        },
        {
          patientId: id,
          name: "New",
          dosage: "1",
          frequency: "daily",
          status: "active",
          startDate: "2026-09-01",
        },
        {
          patientId: id,
          name: "Gone",
          dosage: "1",
          frequency: "daily",
          status: "stopped",
          startDate: "2026-09-01",
        },
      ])
      .run();
    for (let day = 1; day <= MAX_RECENT_SYMPTOMS + 2; day++)
      db.insert(symptoms)
        .values({
          patientId: id,
          name: `Symptom ${day}`,
          severity: 2,
          recordedAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
        })
        .run();
    db.insert(recoveryMilestones)
      .values([
        { patientId: id, title: "Undated" },
        { patientId: id, title: "Later", targetDate: "2026-12-01" },
        { patientId: id, title: "Sooner", targetDate: "2026-09-01", status: "achieved" },
      ])
      .run();

    const dashboard = await getPatientDashboard(id);

    expect(dashboard.activeMedications.map((m) => m.name)).toEqual(["New", "Old"]);
    expect(dashboard.recentSymptoms).toHaveLength(MAX_RECENT_SYMPTOMS);
    expect(dashboard.recentSymptoms[0]?.name).toBe(`Symptom ${MAX_RECENT_SYMPTOMS + 2}`);
    expect(dashboard.milestones.map((m) => m.title)).toEqual(["Sooner", "Later", "Undated"]);
  });

  it("only includes the requested patient's records", async () => {
    const id = insertPatient({ mrn: "FAKE-A" });
    const other = insertPatient({ mrn: "FAKE-B" });
    lab(other, "Secret", "2026-10-01T08:00:00.000Z", "high");
    vital(other, "heart_rate", 99, "2026-10-01T08:00:00.000Z");

    const dashboard = await getPatientDashboard(id);

    expect(dashboard.recentLabs).toEqual([]);
    expect(dashboard.latestVitals).toEqual([]);
  });

  it("returns 404 for an unknown patient", async () => {
    const { status, body } = await testApp.request("GET", "/dashboards/patients/does-not-exist");

    expect(status).toBe(404);
    expect(ApiErrorSchema.parse(body).message).toBe("Patient does-not-exist not found");
  });
});
