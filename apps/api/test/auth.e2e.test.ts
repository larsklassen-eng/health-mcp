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

async function start(mode: "password" | "off" = "password") {
  testApp = await startTestApp(AppModule, [
    {
      provide: ENV,
      useValue: loadEnv({ ...process.env, AUTH_MODE: mode, SESSION_SECRET: SECRET }),
    },
  ]);
  const { db } = testApp.app.get(DatabaseService);
  await createUser(db, { email: "ana@example.com", password: PASSWORD, name: "Ana Example" });
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
    expect(signedIn.user).toEqual({ email: "ana@example.com", name: "Ana Example" });
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

describe("with sign-in off", () => {
  it("lets every request through and says so", async () => {
    await start("off");

    expect((await call("GET", API_ROUTES.patients)).status).toBe(200);
    expect((await call("GET", API_ROUTES.authSession)).body).toEqual({ mode: "off", user: null });
    expect(errorOf(await login("ana@example.com", PASSWORD), 401)).toBe("Sign-in is off.");
  });
});
