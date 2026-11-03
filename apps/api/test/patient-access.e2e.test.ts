import { randomUUID } from "node:crypto";

import {
  API_ROUTES,
  ApiErrorSchema,
  ImagingStudyListResponseSchema,
  ImagingStudySchema,
  LoginResponseSchema,
  PatientDashboardSchema,
  PatientImportResultSchema,
  PatientSchema,
} from "@health-mcp/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { createUser } from "../src/auth/users.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/database/database.service.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

const DOCTOR_PASSWORD = "correct horse battery";
const TEMPORARY = "my dog likes blue trains";
const OWN_PASSWORD = "violet-tram-orbit-91";

/** The only routes open to patients (besides changing their password), read-only. */
const PATIENT_ROUTES = [
  "GET /patients/:id",
  "GET /dashboards/patients/:id",
  "GET /patients/:id/imaging",
  "GET /patients/:id/imaging/:studyId",
  "GET /patients/:id/imaging/:studyId/series/:seriesId/images/:position",
];
/** Routes without a session, and changing one's password (tested elsewhere). */
const NOT_CHECKED = [
  "GET /health",
  "POST /auth/login",
  "POST /auth/register",
  "GET /auth/session",
  "POST /auth/password",
];

let testApp: TestApp;
let doctor: string;
let patientId: string;
let otherPatientId: string;
let studyId: string;
let session: string;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${testApp.url}${path}`, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    // Images and streams are not JSON.
  }
  return { status: response.status, body: parsed };
}

const signIn = async (email: string, password: string) =>
  LoginResponseSchema.parse(
    (await call("POST", API_ROUTES.authLogin, undefined, { email, password })).body,
  ).session;

beforeEach(async () => {
  testApp = await startTestApp(AppModule, [
    {
      provide: ENV,
      useValue: loadEnv({
        ...process.env,
        AUTH_MODE: "password",
        SESSION_SECRET: "test-session-secret-0123456789abcdef",
      }),
    },
  ]);
  const { db } = testApp.app.get(DatabaseService);
  await createUser(db, {
    email: "ana@example.com",
    password: DOCTOR_PASSWORD,
    firstName: "Ana",
    lastName: "Example",
  });
  doctor = await signIn("ana@example.com", DOCTOR_PASSWORD);

  const study = {
    modality: "MR",
    description: "MRI brain (synthetic)",
    studyDate: "2026-07-30",
    impression: "Synthetic impression.",
    report: "Synthetic report for testing.",
  };
  const imported = PatientImportResultSchema.parse(
    (
      await call("POST", API_ROUTES.patientsImport, doctor, {
        version: 1,
        patients: [
          { patient: newPatient({ mrn: "FAKE-OWN" }), imagingStudies: [study] },
          { patient: newPatient({ mrn: "FAKE-OTHER", firstName: "Other" }) },
        ],
      })
    ).body,
  );
  [patientId, otherPatientId] = imported.imported.map((entry) => entry.patientId) as [
    string,
    string,
  ];
  const studies = ImagingStudyListResponseSchema.parse(
    (await call("GET", API_ROUTES.patientImaging(patientId), doctor)).body,
  );
  studyId = studies.studies[0]!.id;

  await call("POST", API_ROUTES.patientAccount(patientId), doctor, {
    email: "pat@example.com",
    password: TEMPORARY,
  });
  const temporary = await signIn("pat@example.com", TEMPORARY);
  session = LoginResponseSchema.parse(
    (
      await call("POST", API_ROUTES.authPassword, temporary, {
        currentPassword: TEMPORARY,
        newPassword: OWN_PASSWORD,
      })
    ).body,
  ).session;
});
afterEach(async () => {
  await testApp.close();
});

/** Every route the app serves, as "METHOD /path", from Express's router. */
function allRoutes(): string[] {
  const express = testApp.app.getHttpAdapter().getInstance() as unknown as {
    router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  return express.router.stack.flatMap(({ route }) =>
    route
      ? Object.keys(route.methods).map((method) => `${method.toUpperCase()} ${route.path}`)
      : [],
  );
}

const fill = (path: string, id: string) =>
  path
    .replace(":id", id)
    .replace(":studyId", studyId)
    .replace(":position", "0")
    .replace(/:\w+/g, () => randomUUID());

describe("a patient's own account", () => {
  it("reads their own profile, dashboard and imaging", async () => {
    const profile = PatientSchema.parse(
      (await call("GET", API_ROUTES.patient(patientId), session)).body,
    );
    expect(profile.mrn).toBe("FAKE-OWN");

    const dashboard = PatientDashboardSchema.parse(
      (await call("GET", API_ROUTES.patientDashboard(patientId), session)).body,
    );
    expect(dashboard.patient.id).toBe(patientId);

    const studies = ImagingStudyListResponseSchema.parse(
      (await call("GET", API_ROUTES.patientImaging(patientId), session)).body,
    );
    expect(studies.studies.map((study) => study.id)).toEqual([studyId]);
    const study = ImagingStudySchema.parse(
      (await call("GET", API_ROUTES.imagingStudy(patientId, studyId), session)).body,
    );
    expect(study.report).toBe("Synthetic report for testing.");
  });

  it("may use exactly the patient routes, and only for their own record", async () => {
    const routes = allRoutes();
    for (const route of PATIENT_ROUTES) expect(routes).toContain(route);

    for (const route of routes.filter((r) => !NOT_CHECKED.includes(r))) {
      const [method, path] = route.split(" ") as [string, string];
      const body = method === "GET" ? undefined : {};
      const own = await call(method, fill(path, patientId), session, body);

      if (PATIENT_ROUTES.includes(route)) {
        expect({ route, status: own.status }).not.toMatchObject({ status: 403 });
        expect({ route, status: own.status }).not.toMatchObject({ status: 401 });
        const other = await call(method, fill(path, otherPatientId), session, body);
        expect({ route, status: other.status }).toEqual({ route, status: 404 });
        expect(other.body).toMatchObject({ message: `Patient ${otherPatientId} not found` });
      } else {
        expect({ route, status: own.status }).toEqual({ route, status: 403 });
        expect(ApiErrorSchema.parse(own.body).message).toBe("Patient accounts cannot use this.");
      }
    }
  });

  it("changes nothing: writes, chat and account changes are refused", async () => {
    for (const [method, path, body] of [
      ["PATCH", API_ROUTES.patient(patientId), { notes: "edited by the patient" }],
      ["DELETE", API_ROUTES.patient(patientId), undefined],
      ["POST", API_ROUTES.patientChat(patientId), { message: "hi" }],
      ["PATCH", API_ROUTES.imagingStudy(patientId, studyId), { report: "changed" }],
      ["DELETE", API_ROUTES.patientAccount(patientId), undefined],
      ["POST", API_ROUTES.patients, newPatient({ mrn: "FAKE-NEW" })],
    ] as const)
      expect((await call(method, path, session, body)).status).toBe(403);

    const profile = PatientSchema.parse(
      (await call("GET", API_ROUTES.patient(patientId), doctor)).body,
    );
    expect(profile.notes).not.toBe("edited by the patient");
    expect((await call("GET", API_ROUTES.patientAccount(patientId), doctor)).body).toMatchObject({
      account: { email: "pat@example.com" },
    });
  });
});
