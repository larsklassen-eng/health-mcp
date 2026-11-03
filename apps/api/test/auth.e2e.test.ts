import {
  API_ROUTES,
  ApiErrorSchema,
  AuthSessionResponseSchema,
  LoginResponseSchema,
} from "@health-mcp/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { TokenSealer } from "../src/auth/sealed-token.js";
import { createUser, removeUser, setPassword } from "../src/auth/users.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/database/database.service.js";
import { startTestApp, type TestApp } from "./helpers.js";

const SECRET = "test-session-secret-0123456789abcdef";
const PASSWORD = "correct horse battery";

let testApp: TestApp | undefined;
afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});

async function start(mode: "password" | "off" = "password", env: Record<string, string> = {}) {
  testApp = await startTestApp(AppModule, [
    {
      provide: ENV,
      useValue: loadEnv({ ...process.env, AUTH_MODE: mode, SESSION_SECRET: SECRET, ...env }),
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

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
) {
  const response = await fetch(`${testApp!.url}${path}`, {
    method,
    headers: {
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
      ...(options.body !== undefined && { "Content-Type": "application/json" }),
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

const login = (email: string, password: string) =>
  call("POST", API_ROUTES.authLogin, { body: { email, password } });

async function signIn() {
  const { status, body } = await login("ana@example.com", PASSWORD);
  expect(status).toBe(200);
  return LoginResponseSchema.parse(body);
}

const errorOf = (response: { status: number; body: unknown }, status: number) => {
  expect(response.status).toBe(status);
  return ApiErrorSchema.parse(response.body).message;
};

describe("with sign-in on", () => {
  it("only lets health checks and sign-in through without a session", async () => {
    await start();

    expect((await call("GET", API_ROUTES.health)).status).toBe(200);
    expect(errorOf(await call("GET", API_ROUTES.patients), 401)).toBe("Sign in to continue.");
    errorOf(await call("GET", API_ROUTES.dashboardOverview), 401);
    errorOf(await call("GET", API_ROUTES.authSession), 401);
    errorOf(await call("GET", API_ROUTES.patients, { token: "not-a-session" }), 401);
  });

  it("signs in with the right password, in any email case, and accepts the session", async () => {
    await start();

    const { status, body } = await login(" ANA@example.com ", PASSWORD);

    expect(status).toBe(200);
    const signedIn = LoginResponseSchema.parse(body);
    expect(signedIn.user).toEqual({
      email: "ana@example.com",
      firstName: "Ana",
      lastName: "Example",
      role: "doctor",
      mustChangePassword: false,
    });
    const hours = (Date.parse(signedIn.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    expect((await call("GET", API_ROUTES.patients, { token: signedIn.session })).status).toBe(200);
    expect(
      AuthSessionResponseSchema.parse(
        (await call("GET", API_ROUTES.authSession, { token: signedIn.session })).body,
      ),
    ).toEqual({ mode: "password", user: signedIn.user });
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await start();

    const wrongPassword = errorOf(await login("ana@example.com", "wrong password!!"), 401);
    const unknownEmail = errorOf(await login("eve@example.com", PASSWORD), 401);

    expect(wrongPassword).toBe("The email or password is incorrect.");
    expect(unknownEmail).toBe(wrongPassword);
  });

  it("validates the request", async () => {
    await start();

    errorOf(await call("POST", API_ROUTES.authLogin, { body: { email: "ana@example.com" } }), 400);
  });

  it("refuses an email for 15 minutes after 5 failed sign-ins, even when right", async () => {
    await start();
    for (let i = 0; i < 5; i++) errorOf(await login("ana@example.com", `wrong ${i} password`), 401);

    expect(errorOf(await login("ana@example.com", PASSWORD), 429)).toBe(
      "Too many failed sign-ins. Try again in 15 minutes.",
    );
  });

  it("ends a user's sessions when their password changes or they are removed", async () => {
    const db = await start();
    const first = await signIn();
    await new Promise((resolve) => setTimeout(resolve, 5));

    await setPassword(db, "ana@example.com", "a brand new password");

    errorOf(await call("GET", API_ROUTES.patients, { token: first.session }), 401);
    const second = LoginResponseSchema.parse(
      (await login("ana@example.com", "a brand new password")).body,
    );
    expect((await call("GET", API_ROUTES.patients, { token: second.session })).status).toBe(200);

    removeUser(db, "ana@example.com");

    errorOf(await call("GET", API_ROUTES.patients, { token: second.session }), 401);
  });

  it("refuses expired sessions and sessions sealed with another secret", async () => {
    await start();
    const { session } = await signIn();
    const sub = new TokenSealer(SECRET).open("session", session)!.sub;
    const past = Date.now() - 61_000;
    const expired = new TokenSealer(SECRET).seal("session", { sub, iat: past }, 60, past);
    const forged = new TokenSealer("another-secret-0123456789abcdefghij").seal(
      "session",
      { sub, iat: Date.now() },
      3600,
    );

    errorOf(await call("GET", API_ROUTES.patients, { token: expired }), 401);
    errorOf(await call("GET", API_ROUTES.patients, { token: forged }), 401);
  });
});

describe("sign-up", () => {
  const ben = {
    firstName: " Ben ",
    lastName: "Example",
    email: " Ben@Example.com ",
    password: "a long sign-up password",
  };
  const register = (body: unknown) => call("POST", API_ROUTES.authRegister, { body });

  it("creates the doctor, signs them in, and lets them sign in again", async () => {
    await start();

    const { status, body } = await register(ben);

    expect(status).toBe(201);
    const signedUp = LoginResponseSchema.parse(body);
    expect(signedUp.user).toEqual({
      email: "ben@example.com",
      firstName: "Ben",
      lastName: "Example",
      role: "doctor",
      mustChangePassword: false,
    });
    const patients = await call("GET", API_ROUTES.patients, { token: signedUp.session });
    expect(patients).toEqual({ status: 200, body: { patients: [] } });
    expect((await login("ben@example.com", ben.password)).status).toBe(200);
  });

  it("says what to fix", async () => {
    await start();

    expect(errorOf(await register({ ...ben, lastName: " " }), 400)).toBe(
      "Enter a first and a last name.",
    );
    expect(errorOf(await register({ ...ben, email: "ben" }), 400)).toBe(
      "That is not an email address.",
    );
    expect(errorOf(await register({ ...ben, password: "short" }), 400)).toBe(
      "Use at least 12 characters.",
    );
    expect(errorOf(await register({ ...ben, password: "password1234" }), 400)).toBe(
      "This is similar to a commonly used password.",
    );
    expect(errorOf(await register({ ...ben, password: "Example forever 2026" }), 400)).toBe(
      "Leave your name and email address out of the password.",
    );
    errorOf(await register({ ...ben, firstName: "x".repeat(101) }), 400);
    errorOf(await register({ email: "ben@example.com" }), 400);
  });

  it("refuses an email that already has an account, in any case", async () => {
    await start();

    expect(errorOf(await register({ ...ben, email: "ANA@example.com" }), 409)).toBe(
      "An account with this email exists. Sign in instead.",
    );
  });

  it("creates at most SIGNUPS_PER_HOUR accounts per hour", async () => {
    await start("password", { SIGNUPS_PER_HOUR: "2" });

    for (const name of ["one", "two"])
      expect((await register({ ...ben, email: `${name}@example.com` })).status).toBe(201);

    expect(errorOf(await register({ ...ben, email: "three@example.com" }), 429)).toBe(
      "Too many new accounts right now. Try again in 60 minutes.",
    );
    // Invalid requests do not use up the limit; they are refused first.
    errorOf(await register({ ...ben, email: "four@example.com", password: "short" }), 400);
  });

  it("is closed with SIGNUPS_PER_HOUR=0, and off with sign-in", async () => {
    await start("password", { SIGNUPS_PER_HOUR: "0" });
    expect(errorOf(await register(ben), 403)).toBe(
      "Sign-up is closed. Ask an administrator for an account.",
    );
    await testApp!.close();

    await start("off");
    expect(errorOf(await register(ben), 401)).toBe("Sign-in is off.");
  });
});

describe("with sign-in off", () => {
  it("lets every request through and says so", async () => {
    await start("off");

    expect((await call("GET", API_ROUTES.patients)).status).toBe(200);
    expect((await call("GET", API_ROUTES.authSession)).body).toEqual({ mode: "off", user: null });
    expect(errorOf(await login("ana@example.com", PASSWORD), 401)).toBe("Sign-in is off.");
  });
});
