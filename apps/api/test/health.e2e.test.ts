import { ApiErrorSchema, API_ROUTES, HealthCheckResponseSchema } from "@health-mcp/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { DatabaseService } from "../src/database/database.service.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
beforeEach(async () => {
  testApp = await startTestApp(AppModule);
});
afterEach(async () => {
  await testApp.close();
});

describe(`GET ${API_ROUTES.health}`, () => {
  it("returns the shared health check response", async () => {
    const response = await fetch(`${testApp.url}${API_ROUTES.health}`);

    expect(response.status).toBe(200);
    const body = HealthCheckResponseSchema.parse(await response.json());
    expect(body.service).toBe("api");
  });

  it("returns 503 when the database cannot be queried", async () => {
    testApp.app.get(DatabaseService).onApplicationShutdown();

    const response = await fetch(`${testApp.url}${API_ROUTES.health}`);

    expect(response.status).toBe(503);
    expect(ApiErrorSchema.parse(await response.json()).message).toBe("Database is not reachable");
  });
});

describe("app wiring", () => {
  it("returns unknown routes as a shared ApiError", async () => {
    const response = await fetch(`${testApp.url}/does-not-exist`);

    expect(response.status).toBe(404);
    expect(ApiErrorSchema.parse(await response.json())).toMatchObject({ statusCode: 404, error: "Not Found" });
  });

  it("allows CORS requests from the web app only", async () => {
    const allowed = await fetch(`${testApp.url}${API_ROUTES.health}`, { headers: { Origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const other = await fetch(`${testApp.url}${API_ROUTES.health}`, { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });
});
