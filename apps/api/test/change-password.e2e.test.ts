import { users } from "@health-mcp/db";
import { API_ROUTES, ApiErrorSchema, LoginResponseSchema, PatientSchema } from "@health-mcp/shared";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { createUser } from "../src/auth/users.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/database/database.service.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "violet-tram-orbit-91";

let testApp: TestApp | undefined;
afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});

async function start(mode: "password" | "off" = "password") {
  testApp = await startTestApp(AppModule, [
    {
      provide: ENV,
      useValue: loadEnv({
        ...process.env,
        AUTH_MODE: mode,
        SESSION_SECRET: "test-session-secret-0123456789abcdef",
      }),
    },
  ]);
  const { db } = testApp.app.get(DatabaseService);
  await createUser(db, {
    email: "ana@example.com",
    password: PASSWORD,
    firstName: "Ana",
    lastName: "Example",
  });
  return db;
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${testApp!.url}${path}`, {
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
const signIn = async (email: string, password: string) =>
  LoginResponseSchema.parse((await login(email, password)).body).session;
const change = (token: string | undefined, currentPassword: string, newPassword: string) =>
  call("POST", API_ROUTES.authPassword, token, { currentPassword, newPassword });

const errorOf = (response: { status: number; body: unknown }, status: number) => {
  expect(response.status).toBe(status);
  return ApiErrorSchema.parse(response.body).message;
};

describe("changing one's own password", () => {
  it("replaces it, ends earlier sessions and answers with a new one", async () => {
    await start();
    const before = await signIn("ana@example.com", PASSWORD);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await change(before, PASSWORD, NEW_PASSWORD);

    expect(response.status).toBe(200);
    const after = LoginResponseSchema.parse(response.body);
    expect(after.user.mustChangePassword).toBe(false);
    errorOf(await call("GET", API_ROUTES.patients, before), 401);
    expect((await call("GET", API_ROUTES.patients, after.session)).status).toBe(200);
    expect((await login("ana@example.com", PASSWORD)).status).toBe(401);
    expect((await login("ana@example.com", NEW_PASSWORD)).status).toBe(200);
  });

  it("says what to fix", async () => {
    await start();
    const session = await signIn("ana@example.com", PASSWORD);

    expect(errorOf(await change(session, "wrong password!!", NEW_PASSWORD), 400)).toBe(
      "The current password is incorrect.",
    );
    expect(errorOf(await change(session, PASSWORD, PASSWORD), 400)).toBe(
      "Choose a password different from the current one.",
    );
    expect(errorOf(await change(session, PASSWORD, "password1234"), 400)).toBe(
      "This is similar to a commonly used password.",
    );
    expect(errorOf(await change(session, PASSWORD, "Example rocks 2026!"), 400)).toBe(
      "Leave your name and email address out of the password.",
    );
    errorOf(await change(undefined, PASSWORD, NEW_PASSWORD), 401);
  });

  it("stops guessing the current password after 5 wrong attempts", async () => {
    await start();
    const session = await signIn("ana@example.com", PASSWORD);
    for (let i = 0; i < 5; i++)
      errorOf(await change(session, `wrong ${i} password`, NEW_PASSWORD), 400);

    expect(errorOf(await change(session, PASSWORD, NEW_PASSWORD), 429)).toBe(
      "Too many failed attempts. Try again in 15 minutes.",
    );
  });

  it("is off with sign-in", async () => {
    await start("off");

    expect(errorOf(await change(undefined, PASSWORD, NEW_PASSWORD), 401)).toBe("Sign-in is off.");
  });
});

describe("a temporary password", () => {
  it("allows nothing but the session and changing it, for doctors too", async () => {
    const db = await start();
    db.update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.email, "ana@example.com"))
      .run();
    const session = await signIn("ana@example.com", PASSWORD);

    expect(errorOf(await call("GET", API_ROUTES.patients, session), 403)).toBe(
      "Choose a new password first.",
    );
    expect((await call("GET", API_ROUTES.authSession, session)).body).toMatchObject({
      user: { mustChangePassword: true },
    });

    const changed = LoginResponseSchema.parse((await change(session, PASSWORD, NEW_PASSWORD)).body);

    expect((await call("GET", API_ROUTES.patients, changed.session)).status).toBe(200);
  });

  it("must be replaced by a patient, who then still reaches nothing else (yet)", async () => {
    await start();
    const doctor = await signIn("ana@example.com", PASSWORD);
    const patient = PatientSchema.parse(
      (await call("POST", API_ROUTES.patients, doctor, newPatient())).body,
    );
    await call("POST", API_ROUTES.patientAccount(patient.id), doctor, {
      email: "pat@example.com",
      password: "my dog likes blue trains",
    });
    const session = await signIn("pat@example.com", "my dog likes blue trains");

    expect(errorOf(await call("GET", API_ROUTES.patient(patient.id), session), 403)).toBe(
      "Choose a new password first.",
    );
    const changed = LoginResponseSchema.parse(
      (await change(session, "my dog likes blue trains", NEW_PASSWORD)).body,
    );

    expect(changed.user).toMatchObject({ role: "patient", mustChangePassword: false });
    expect(errorOf(await call("GET", API_ROUTES.patient(patient.id), changed.session), 403)).toBe(
      "Patient accounts cannot use this yet.",
    );
    const account = await call("GET", API_ROUTES.patientAccount(patient.id), doctor);
    expect(account.body).toMatchObject({ account: { mustChangePassword: false } });
  });
});
