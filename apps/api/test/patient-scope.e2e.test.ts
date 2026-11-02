import { randomUUID } from "node:crypto";

import { patients } from "@health-mcp/db";
import {
  API_ROUTES,
  DashboardOverviewSchema,
  LoginResponseSchema,
  PatientListResponseSchema,
  PatientSchema,
} from "@health-mcp/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { createUser } from "../src/auth/users.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/database/database.service.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

const PASSWORD = "correct horse battery";

let testApp: TestApp;
let ana: string;
let ben: string;

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
  for (const [email, firstName] of [
    ["ana@example.com", "Ana"],
    ["ben@example.com", "Ben"],
  ] as const)
    await createUser(db, { email, password: PASSWORD, firstName, lastName: "Example" });
  ana = await signIn("ana@example.com");
  ben = await signIn("ben@example.com");
});
afterEach(async () => {
  await testApp.close();
});

async function call(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${testApp.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${testApp.url}${API_ROUTES.authLogin}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return LoginResponseSchema.parse(await response.json()).session;
}

async function createPatient(token: string, mrn = "FAKE-001") {
  const { status, body } = await call("POST", API_ROUTES.patients, token, newPatient({ mrn }));
  expect(status).toBe(201);
  return PatientSchema.parse(body);
}

/** Every route the app serves whose path has `patients/:id`, from Express's router. */
function patientRoutes(): { method: string; path: string }[] {
  const express = testApp.app.getHttpAdapter().getInstance() as unknown as {
    router: {
      stack: { route?: { path: string; methods: Record<string, boolean> } }[];
    };
  };
  return express.router.stack.flatMap(({ route }) =>
    route && /\/patients\/:id(\/|$)/.test(route.path)
      ? Object.keys(route.methods).map((method) => ({
          method: method.toUpperCase(),
          path: route.path,
        }))
      : [],
  );
}

describe("each doctor's patients", () => {
  it("lists and counts only the signed-in doctor's patients", async () => {
    const patient = await createPatient(ana);

    const forAna = PatientListResponseSchema.parse((await call("GET", "/patients", ana)).body);
    const forBen = PatientListResponseSchema.parse((await call("GET", "/patients", ben)).body);
    expect(forAna.patients.map((p) => p.id)).toEqual([patient.id]);
    expect(forBen.patients).toEqual([]);

    const overview = DashboardOverviewSchema.parse(
      (await call("GET", API_ROUTES.dashboardOverview, ben)).body,
    );
    expect(overview.totalPatients).toBe(0);
    expect(overview.patients).toEqual([]);
  });

  it("makes the creator the owner, and allows the same MRN for another doctor", async () => {
    const patient = await createPatient(ana);
    await createPatient(ben);

    const { db } = testApp.app.get(DatabaseService);
    const row = db.select().from(patients).where(eq(patients.id, patient.id)).get();
    const anaId = (await call("GET", API_ROUTES.authSession, ana)).body;
    expect(row?.ownerId).toBeTruthy();
    expect(anaId).toMatchObject({ user: { email: "ana@example.com" } });
    expect((await call("POST", API_ROUTES.patients, ana, newPatient())).status).toBe(409);
  });

  it("answers 404 on every route about another doctor's patient", async () => {
    const patient = await createPatient(ana);
    const routes = patientRoutes();
    // Profile, chat, tool-call decisions, imaging and the patient dashboard.
    expect(routes.length).toBeGreaterThanOrEqual(13);

    for (const { method, path } of routes) {
      const url = path
        .replace(":id", patient.id)
        .replace(/:position\b/, "0")
        .replace(/:\w+/g, () => randomUUID());
      const response = await call(method, url, ben, method === "GET" ? undefined : {});
      expect({ method, path, status: response.status }).toEqual({ method, path, status: 404 });
      expect(response.body).toMatchObject({ message: `Patient ${patient.id} not found` });
    }

    expect((await call("GET", `/patients/${patient.id}`, ana)).status).toBe(200);
    expect((await call("GET", `/dashboards/patients/${patient.id}`, ana)).status).toBe(200);
  });

  it("does not let another doctor change or delete the patient", async () => {
    const patient = await createPatient(ana);

    expect((await call("PATCH", `/patients/${patient.id}`, ben, { notes: "x" })).status).toBe(404);
    expect((await call("DELETE", `/patients/${patient.id}`, ben)).status).toBe(404);

    const after = PatientSchema.parse((await call("GET", `/patients/${patient.id}`, ana)).body);
    expect(after.notes).toBe(patient.notes);
  });

  it("gives imported patients to the importing doctor", async () => {
    const file = { version: 1, patients: [{ patient: newPatient({ mrn: "FAKE-IMP" }) }] };
    expect((await call("POST", "/patients/import", ana, file)).status).toBe(201);
    expect((await call("POST", "/patients/import", ben, file)).status).toBe(201);

    const forBen = PatientListResponseSchema.parse((await call("GET", "/patients", ben)).body);
    expect(forBen.patients.map((p) => p.mrn)).toEqual(["FAKE-IMP"]);
  });
});
