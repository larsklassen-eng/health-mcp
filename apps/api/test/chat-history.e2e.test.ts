import { chatMessages } from "@health-mcp/db";
import {
  API_ROUTES,
  ApiErrorSchema,
  ChatHistoryResponseSchema,
  type Patient,
  PatientSchema,
} from "@health-mcp/shared";
import { NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { ChatHistoryService } from "../src/chat/chat-history.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
let history: ChatHistoryService;
beforeEach(async () => {
  testApp = await startTestApp(AppModule);
  history = testApp.app.get(ChatHistoryService);
});
afterEach(async () => {
  await testApp.close();
});

async function createPatient(mrn = "FAKE-001"): Promise<Patient> {
  const { body } = await testApp.request("POST", API_ROUTES.patients, newPatient({ mrn }));
  return PatientSchema.parse(body);
}

async function getHistory(patientId: string) {
  const { status, body } = await testApp.request("GET", API_ROUTES.patientChat(patientId));
  return { status, body };
}

describe(`GET ${API_ROUTES.patientChat(":id")}`, () => {
  it("returns an empty history for a new patient", async () => {
    const patient = await createPatient();
    const { status, body } = await getHistory(patient.id);

    expect(status).toBe(200);
    expect(body).toEqual({ messages: [] });
  });

  it("returns messages oldest first in the shared response shape", async () => {
    const patient = await createPatient();
    history.append(patient.id, { role: "user", content: "Any abnormal labs?" });
    history.append(patient.id, {
      role: "assistant",
      content: "Hemoglobin is low at 11.2 g/dL.",
      toolCalls: [
        {
          id: "t1",
          name: "get_lab_results",
          input: { limit: 5 },
          output: [{ value: 11.2 }],
          isError: false,
        },
      ],
    });

    const { status, body } = await getHistory(patient.id);
    const { messages } = ChatHistoryResponseSchema.parse(body);

    expect(status).toBe(200);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Any abnormal labs?"],
      ["assistant", "Hemoglobin is low at 11.2 g/dL."],
    ]);
    expect(messages[0]?.toolCalls).toEqual([]);
    expect(messages[1]?.toolCalls[0]).toMatchObject({
      name: "get_lab_results",
      input: { limit: 5 },
    });
    expect(messages.every((m) => m.patientId === patient.id)).toBe(true);
  });

  // SQLite already returns equal created_at values in rowid order via the index, so this passes
  // even without the explicit rowid tie-breaker; it documents the guarantee rather than proving it.
  it("keeps insertion order for messages saved in the same millisecond", async () => {
    const patient = await createPatient();
    const contents = Array.from({ length: 20 }, (_, i) => `message ${i}`);
    for (const content of contents) history.append(patient.id, { role: "user", content });

    const { messages } = ChatHistoryResponseSchema.parse((await getHistory(patient.id)).body);

    expect(messages.map((m) => m.content)).toEqual(contents);
  });

  it("only returns the requested patient's messages", async () => {
    const first = await createPatient("FAKE-1");
    const second = await createPatient("FAKE-2");
    history.append(first.id, { role: "user", content: "About the first patient" });
    history.append(second.id, { role: "user", content: "About the second patient" });

    const { messages } = ChatHistoryResponseSchema.parse((await getHistory(second.id)).body);

    expect(messages.map((m) => m.content)).toEqual(["About the second patient"]);
  });

  it("returns 404 for an unknown patient", async () => {
    const { status, body } = await getHistory("does-not-exist");

    expect(status).toBe(404);
    expect(ApiErrorSchema.parse(body).message).toContain("does-not-exist");
  });

  it("returns 400 for an id that is too long", async () => {
    expect((await getHistory("x".repeat(65))).status).toBe(400);
  });

  it("is deleted together with the patient", async () => {
    const patient = await createPatient();
    history.append(patient.id, { role: "user", content: "Hi" });

    await testApp.request("DELETE", API_ROUTES.patient(patient.id));

    expect((await getHistory(patient.id)).status).toBe(404);
    expect(testApp.app.get(DatabaseService).db.select().from(chatMessages).all()).toEqual([]);
  });
});

describe("ChatHistoryService.append", () => {
  it("returns the saved message with generated id and timestamp", async () => {
    const patient = await createPatient();
    const message = history.append(patient.id, { role: "user", content: "Hi" });

    expect(message).toMatchObject({
      patientId: patient.id,
      role: "user",
      content: "Hi",
      toolCalls: [],
    });
    expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(message.createdAt).toMatch(/Z$/);
  });

  it("throws 404 for an unknown patient instead of saving", () => {
    expect(() => history.append("does-not-exist", { role: "user", content: "Hi" })).toThrow(
      NotFoundException,
    );
    expect(testApp.app.get(DatabaseService).db.select().from(chatMessages).all()).toEqual([]);
  });
});
