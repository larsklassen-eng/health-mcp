import { createHash } from "node:crypto";

import {
  API_ROUTES,
  ApiErrorSchema,
  AuthCallbackResponseSchema,
  AuthSessionResponseSchema,
  AuthStartResponseSchema,
} from "@health-mcp/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { GoogleOAuth } from "../src/auth/google-oauth.js";
import { TokenSealer } from "../src/auth/sealed-token.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { FAKE_CLIENT_ID, FakeGoogleOAuth } from "./fakes/fake-google-oauth.js";
import { startTestApp, type TestApp } from "./helpers.js";

const SECRET = "test-session-secret-0123456789abcdef";
const signInEnv = (overrides: Record<string, string> = {}) =>
  loadEnv({
    ...process.env,
    AUTH_MODE: "google",
    GOOGLE_CLIENT_ID: FAKE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "fake-secret",
    SESSION_SECRET: SECRET,
    AUTH_ALLOWED_EMAILS: "ana@example.com",
    WEB_ORIGIN: "https://health.example.test",
    ...overrides,
  });

let testApp: TestApp | undefined;
let google: FakeGoogleOAuth;

async function start(envOverrides: Record<string, string> = {}) {
  google = new FakeGoogleOAuth();
  testApp = await startTestApp(AppModule, [
    { provide: ENV, useValue: signInEnv(envOverrides) },
    { provide: GoogleOAuth, useValue: google },
  ]);
  return testApp;
}

afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});

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

/** Starts a sign-in and returns what the browser would bring back from Google. */
async function startSignIn() {
  const started = AuthStartResponseSchema.parse(
    (await call("POST", API_ROUTES.authGoogleStart)).body,
  );
  const state = new URL(started.url).searchParams.get("state")!;
  return { code: "google-code", state, loginState: started.loginState };
}

async function signIn() {
  const { status, body } = await call("POST", API_ROUTES.authGoogleCallback, {
    body: await startSignIn(),
  });
  expect(status).toBe(200);
  return AuthCallbackResponseSchema.parse(body);
}

const expectError = (response: { status: number; body: unknown }, status: number) => {
  expect(response.status).toBe(status);
  return ApiErrorSchema.parse(response.body).message;
};

describe("with sign-in on", () => {
  it("only lets health checks and sign-in through without a session", async () => {
    await start();

    expect((await call("GET", API_ROUTES.health)).status).toBe(200);
    expect(expectError(await call("GET", API_ROUTES.patients), 401)).toBe("Sign in to continue.");
    expectError(await call("GET", API_ROUTES.dashboardOverview), 401);
    expectError(await call("GET", API_ROUTES.authSession), 401);
    expectError(await call("GET", API_ROUTES.patients, { token: "not-a-session" }), 401);
  });

  it("starts a Google sign-in with state, nonce and PKCE, returning to apps/web", async () => {
    await start();

    const { state } = await startSignIn();

    const [request] = google.requests;
    expect(request).toMatchObject({
      redirectUri: "https://health.example.test/auth/callback",
      state,
    });
    expect(request!.nonce).toMatch(/^[\w-]{20,}$/);
    expect(request!.state).not.toBe(request!.nonce);
  });

  it("signs in an allowed, verified Google account and accepts its session", async () => {
    await start();

    const signedIn = await signIn();

    expect(signedIn.user).toEqual({ email: "ana@example.com", name: "Ana Example" });
    const hours = (Date.parse(signedIn.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    // PKCE: the verifier sent to Google matches the challenge of the sign-in it started.
    const codeChallenge = google.requests[0]!.codeChallenge;
    const { codeVerifier, redirectUri } = google.exchanges[0]!;
    expect(createHash("sha256").update(codeVerifier).digest("base64url")).toBe(codeChallenge);
    expect(redirectUri).toBe("https://health.example.test/auth/callback");

    expect((await call("GET", API_ROUTES.patients, { token: signedIn.session })).status).toBe(200);
    expect(
      AuthSessionResponseSchema.parse(
        (await call("GET", API_ROUTES.authSession, { token: signedIn.session })).body,
      ),
    ).toEqual({ mode: "google", user: signedIn.user });
  });

  it("matches the allowlist without regard to case", async () => {
    await start();
    google.claims = { email: "ANA@Example.com" };

    expect((await signIn()).user.email).toBe("ana@example.com");
  });

  it("refuses accounts that are not on the allowlist", async () => {
    await start();
    google.claims = { email: "eve@example.com" };

    const response = await call("POST", API_ROUTES.authGoogleCallback, {
      body: await startSignIn(),
    });
    expect(expectError(response, 403)).toBe("eve@example.com may not use this deployment.");
  });

  it.each([
    ["another app's token", { aud: "other-client" }],
    ["another issuer", { iss: "https://evil.example.test" }],
    ["an expired ID token", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["a replayed nonce", { nonce: "other-nonce" }],
    ["an unverified email", { email_verified: false }],
  ])("refuses %s", async (_, claims) => {
    await start();
    google.claims = claims;

    const response = await call("POST", API_ROUTES.authGoogleCallback, {
      body: await startSignIn(),
    });
    expect(expectError(response, 401)).toBe("Google sign-in could not be verified. Try again.");
  });

  it("refuses a callback with another state, or a changed sign-in state", async () => {
    await start();
    const returned = await startSignIn();

    for (const body of [
      { ...returned, state: "other-state" },
      { ...returned, loginState: `${returned.loginState.slice(0, -2)}xx` },
    ]) {
      const response = await call("POST", API_ROUTES.authGoogleCallback, { body });
      expect(expectError(response, 401)).toMatch(/expired or was not started here/);
    }
    expect(google.exchanges).toEqual([]);
  });

  it("reports a failed code exchange without details", async () => {
    await start();
    google.fail = true;

    const response = await call("POST", API_ROUTES.authGoogleCallback, {
      body: await startSignIn(),
    });
    expect(expectError(response, 401)).toBe("Google sign-in failed. Try again.");
  });

  it("ends sessions of addresses removed from the allowlist", async () => {
    await start();
    const { session } = await signIn();
    await testApp!.close();

    await start({ AUTH_ALLOWED_EMAILS: "ben@example.com" });

    expectError(await call("GET", API_ROUTES.patients, { token: session }), 401);
  });

  it("refuses expired sessions, and sign-in state used as a session", async () => {
    await start();
    const sealer = new TokenSealer(SECRET);
    const expired = sealer.seal("session", { email: "ana@example.com" }, 60, Date.now() - 61_000);
    const { loginState } = await startSignIn();

    expectError(await call("GET", API_ROUTES.patients, { token: expired }), 401);
    expectError(await call("GET", API_ROUTES.patients, { token: loginState }), 401);
  });
});

describe("with sign-in off", () => {
  it("lets every request through and says so", async () => {
    await start({ AUTH_MODE: "off" });

    expect((await call("GET", API_ROUTES.patients)).status).toBe(200);
    expect((await call("GET", API_ROUTES.authSession)).body).toEqual({ mode: "off", user: null });
    expect(expectError(await call("POST", API_ROUTES.authGoogleStart), 404)).toBe(
      "Sign-in is off.",
    );
  });
});
