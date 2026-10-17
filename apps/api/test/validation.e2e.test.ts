import {
  ApiErrorSchema,
  type CreatePatientInput,
  CreatePatientInputSchema,
} from "@health-mcp/shared";
import { Body, Controller, Get, HttpCode, Module, Post } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigModule } from "../src/config/config.module.js";
import { startTestApp, type TestApp } from "./helpers.js";

/** Test-only routes that exercise the global validation pipe and exception filter. */
@Controller("test")
class ProbeController {
  @Post("patients")
  @HttpCode(200)
  echo(@Body({ schema: CreatePatientInputSchema }) body: CreatePatientInput) {
    return body;
  }

  @Get("crash")
  crash() {
    throw new Error("secret internal detail");
  }
}

@Module({ imports: [ConfigModule], controllers: [ProbeController] })
class ProbeModule {}

let testApp: TestApp;
beforeAll(async () => {
  testApp = await startTestApp(ProbeModule);
});
afterAll(async () => {
  await testApp.close();
});

const post = (body: unknown) =>
  fetch(`${testApp.url}/test/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("request validation", () => {
  it("passes the parsed value (with defaults) to the handler", async () => {
    const response = await post({
      mrn: "FAKE-001",
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      diagnosis: "Synthetic meningioma",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mrn: "FAKE-001", status: "active" });
  });

  it("returns 400 with one entry per invalid field", async () => {
    const response = await post({ mrn: "", sex: "robot" });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.message).toBe("Validation failed");
    const paths = (body.details as { path: string }[]).map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining(["mrn", "sex", "firstName", "lastName", "dateOfBirth", "diagnosis"]),
    );
  });
});

describe("unexpected errors", () => {
  it("returns a generic 500 without leaking the error message", async () => {
    const response = await fetch(`${testApp.url}/test/crash`);

    expect(response.status).toBe(500);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.message).toBe("Something went wrong");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });
});
