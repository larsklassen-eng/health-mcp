import {
  API_ROUTES,
  ApiErrorSchema,
  LoginResponseSchema,
  PatientAccountResponseSchema,
  PatientAccountSchema,
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

let testApp: TestApp;
let ana: string;

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
    await createUser(db, { email, password: DOCTOR_PASSWORD, firstName, lastName: "Example" });
  ana = await signIn("ana@example.com", DOCTOR_PASSWORD);
});
afterEach(async () => {
  await testApp.close();
});

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
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const login = (email: string, password: string) =>
  call("POST", API_ROUTES.authLogin, undefined, { email, password });

async function signIn(email: string, password: string): Promise<string> {
  return LoginResponseSchema.parse((await login(email, password)).body).session;
}

const errorOf = (response: { status: number; body: unknown }, status: number) => {
  expect(response.status).toBe(status);
  return ApiErrorSchema.parse(response.body).message;
};

async function createPatient() {
  const { body } = await call(
    "POST",
    API_ROUTES.patients,
    ana,
    newPatient({ firstName: "Pat", lastName: "Morales" }),
  );
  return PatientSchema.parse(body);
}

const createAccount = (
  patientId: string,
  body: unknown = { email: "pat@example.com", password: TEMPORARY },
) => call("POST", API_ROUTES.patientAccount(patientId), ana, body);

describe("a patient's account, managed by their doctor", () => {
  it("is created with a temporary password, and the patient can sign in", async () => {
    const patient = await createPatient();
    expect((await call("GET", API_ROUTES.patientAccount(patient.id), ana)).body).toEqual({
      account: null,
    });

    const created = await createAccount(patient.id, {
      email: " Pat@Example.com ",
      password: TEMPORARY,
    });

    expect(created.status).toBe(201);
    expect(PatientAccountSchema.parse(created.body)).toMatchObject({
      email: "pat@example.com",
      mustChangePassword: true,
    });
    const shown = PatientAccountResponseSchema.parse(
      (await call("GET", API_ROUTES.patientAccount(patient.id), ana)).body,
    );
    expect(shown.account?.email).toBe("pat@example.com");

    const signedIn = LoginResponseSchema.parse((await login("pat@example.com", TEMPORARY)).body);
    expect(signedIn.user).toEqual({
      email: "pat@example.com",
      firstName: "Pat",
      lastName: "Morales",
      role: "patient",
      patientId: patient.id,
      mustChangePassword: true,
    });
  });

  it("checks the email and the password rules, with the patient's names", async () => {
    const patient = await createPatient();

    expect(
      errorOf(await createAccount(patient.id, { email: "pat", password: TEMPORARY }), 400),
    ).toBe("That is not an email address.");
    expect(
      errorOf(
        await createAccount(patient.id, { email: "pat@example.com", password: "password1234" }),
        400,
      ),
    ).toBe("This is similar to a commonly used password.");
    expect(
      errorOf(
        await createAccount(patient.id, {
          email: "pat@example.com",
          password: "Morales forever 2026",
        }),
        400,
      ),
    ).toBe("Leave your name and email address out of the password.");
  });

  it("allows one account per patient, and no email that is taken", async () => {
    const patient = await createPatient();
    expect((await createAccount(patient.id)).status).toBe(201);

    expect(errorOf(await createAccount(patient.id), 409)).toBe(
      "This patient already has an account.",
    );
    const other = await call("POST", API_ROUTES.patients, ana, newPatient({ mrn: "FAKE-002" }));
    const otherId = PatientSchema.parse(other.body).id;
    expect(
      errorOf(await createAccount(otherId, { email: "BEN@example.com", password: TEMPORARY }), 409),
    ).toBe("An account with this email exists.");
  });

  it("resets the temporary password, ending the patient's sessions", async () => {
    const patient = await createPatient();
    await createAccount(patient.id);
    const session = await signIn("pat@example.com", TEMPORARY);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const reset = await call("PUT", API_ROUTES.patientAccountPassword(patient.id), ana, {
      password: "violet-tram-orbit-91",
    });

    expect(reset.status).toBe(200);
    expect(PatientAccountSchema.parse(reset.body).mustChangePassword).toBe(true);
    errorOf(await call("GET", API_ROUTES.authSession, session), 401);
    expect((await login("pat@example.com", TEMPORARY)).status).toBe(401);
    expect((await login("pat@example.com", "violet-tram-orbit-91")).status).toBe(200);
    expect(
      errorOf(
        await call("PUT", API_ROUTES.patientAccountPassword(patient.id), ana, {
          password: "short",
        }),
        400,
      ),
    ).toBe("Use at least 12 characters.");
  });

  it("is removed by the doctor, or with the patient record", async () => {
    const patient = await createPatient();
    await createAccount(patient.id);

    expect((await call("DELETE", API_ROUTES.patientAccount(patient.id), ana)).status).toBe(204);
    expect((await login("pat@example.com", TEMPORARY)).status).toBe(401);
    expect(errorOf(await call("DELETE", API_ROUTES.patientAccount(patient.id), ana), 404)).toBe(
      "This patient has no account.",
    );
    expect(
      errorOf(
        await call("PUT", API_ROUTES.patientAccountPassword(patient.id), ana, {
          password: TEMPORARY,
        }),
        404,
      ),
    ).toBe("This patient has no account.");

    await createAccount(patient.id);
    expect((await call("DELETE", API_ROUTES.patient(patient.id), ana)).status).toBe(204);
    expect((await login("pat@example.com", TEMPORARY)).status).toBe(401);
  });

  it("is out of reach for other doctors", async () => {
    const patient = await createPatient();
    const ben = await signIn("ben@example.com", DOCTOR_PASSWORD);

    expect((await call("GET", API_ROUTES.patientAccount(patient.id), ben)).status).toBe(404);
    expect(
      (
        await call("POST", API_ROUTES.patientAccount(patient.id), ben, {
          email: "pat@example.com",
          password: TEMPORARY,
        })
      ).status,
    ).toBe(404);
    expect((await login("pat@example.com", TEMPORARY)).status).toBe(401);
  });

  it("must replace the temporary password before anything else", async () => {
    const patient = await createPatient();
    await createAccount(patient.id);
    const session = await signIn("pat@example.com", TEMPORARY);

    // After the change, patients still reach nothing yet (see change-password.e2e.test.ts).
    for (const path of [API_ROUTES.patients, API_ROUTES.patient(patient.id)])
      expect(errorOf(await call("GET", path, session), 403)).toBe("Choose a new password first.");
    expect((await call("GET", API_ROUTES.authSession, session)).status).toBe(200);
    errorOf(await call("POST", API_ROUTES.patients, session, newPatient({ mrn: "FAKE-9" })), 403);
  });
});
