import { labResults } from "@health-mcp/db";
import {
  API_ROUTES,
  ApiErrorSchema,
  ChatHistoryResponseSchema,
  type ChatStreamEvent,
  ChatStreamEventSchema,
  type Patient,
  PatientSchema,
} from "@health-mcp/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { OMITTED_HISTORY_NOTE } from "../src/chat/chat.service.js";
import { ENV } from "../src/config/config.module.js";
import { DatabaseService } from "../src/database/database.service.js";
import { loadEnv } from "../src/config/env.js";
import { LlmClient, LlmError } from "../src/llm/llm-client.js";
import { FakeLlmClient } from "./fakes/fake-llm-client.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
let llm: FakeLlmClient;
let patient: Patient;

beforeEach(async () => {
  llm = new FakeLlmClient();
  testApp = await startTestApp(AppModule, [{ provide: LlmClient, useValue: llm }]);
  const { body } = await testApp.request(
    "POST",
    API_ROUTES.patients,
    newPatient({
      firstName: "Ana",
      lastName: "Test",
      diagnosis: "Synthetic meningioma",
      surgeryDate: "2026-09-01",
    }),
  );
  patient = PatientSchema.parse(body);
});
afterEach(async () => {
  await testApp.close();
});

/** Parses an SSE body into validated chat events. */
function parseEvents(text: string): ChatStreamEvent[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => ChatStreamEventSchema.parse(JSON.parse(block.slice("data: ".length))));
}

async function sendChat(patientId: string, body: unknown) {
  const response = await fetch(`${testApp.url}${API_ROUTES.patientChat(patientId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const isStream = response.headers.get("content-type")?.startsWith("text/event-stream") ?? false;
  return {
    status: response.status,
    isStream,
    events: isStream ? parseEvents(text) : [],
    json: isStream ? undefined : JSON.parse(text),
  };
}

const answerText = (events: ChatStreamEvent[]) =>
  events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : [])).join("");

async function history() {
  const { body } = await testApp.request("GET", API_ROUTES.patientChat(patient.id));
  return ChatHistoryResponseSchema.parse(body).messages;
}

describe(`POST ${API_ROUTES.patientChat(":id")}`, () => {
  it("streams the answer as start, text deltas and end events", async () => {
    llm.replyWithText("Surgery was on 2026-09-01; I cannot see her labs yet.");

    const { status, isStream, events } = await sendChat(patient.id, {
      message: "When was her surgery?",
    });

    expect(status).toBe(200);
    expect(isStream).toBe(true);
    expect(events[0]?.type).toBe("message_start");
    expect(events.at(-1)).toMatchObject({ type: "message_end", stopReason: "stop" });
    expect(events.slice(1, -1).every((event) => event.type === "text_delta")).toBe(true);
    expect(answerText(events)).toBe("Surgery was on 2026-09-01; I cannot see her labs yet.");
  });

  it("saves the question and the answer, using the streamed message id", async () => {
    llm.replyWithText("Hello.");

    const { events } = await sendChat(patient.id, { message: "  Hi  " });
    const messages = await history();

    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hi"],
      ["assistant", "Hello."],
    ]);
    const start = events[0];
    expect(start?.type === "message_start" && start.messageId).toBe(messages[1]?.id);
  });

  it("sends a patient-specific system prompt, the history and the new message, without tools", async () => {
    llm.replyWithText("First answer.").replyWithText("Second answer.");

    await sendChat(patient.id, { message: "First question" });
    await sendChat(patient.id, { message: "Second question" });

    const request = llm.requests[1]!;
    expect(request.tools ?? []).toEqual([]);
    expect(request.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(request.messages.slice(1).map((m) => m.content)).toEqual([
      "First question",
      "First answer.",
      "Second question",
    ]);

    const system = request.messages[0]!.content;
    expect(system).toContain("Ana Test");
    expect(system).toContain("Synthetic meningioma");
    expect(system).toContain("Surgery date: 2026-09-01");
    expect(system).not.toContain(OMITTED_HISTORY_NOTE);
  });

  it("leaves out older messages beyond CHAT_HISTORY_MAX_CHARS and tells the model", async () => {
    await testApp.close();
    testApp = await startTestApp(AppModule, [
      { provide: LlmClient, useValue: llm },
      { provide: ENV, useValue: { ...loadEnv(), CHAT_HISTORY_MAX_CHARS: 1_000 } },
    ]);
    const { body } = await testApp.request("POST", API_ROUTES.patients, newPatient());
    const id = PatientSchema.parse(body).id;
    const long = (label: string) => `${label} ${"x".repeat(400)}`;
    llm.replyWithText(long("A1")).replyWithText(long("A2")).replyWithText("A3");

    await sendChat(id, { message: long("Q1") });
    await sendChat(id, { message: long("Q2") });
    await sendChat(id, { message: "Q3" });

    const request = llm.requests[2]!;
    // Q1 and A1 no longer fit in 1000 characters next to Q2 and A2.
    expect(request.messages.slice(1).map((m) => m.content.slice(0, 2))).toEqual(["Q2", "A2", "Q3"]);
    expect(request.messages[0]!.content).toContain(OMITTED_HISTORY_NOTE);
    // The saved history is not affected.
    const { body: saved } = await testApp.request("GET", API_ROUTES.patientChat(id));
    expect(ChatHistoryResponseSchema.parse(saved).messages).toHaveLength(6);
  });

  it("tells the model the patient's lab test names", async () => {
    const db = testApp.app.get(DatabaseService).db;
    for (const testName of ["Sodium", "ALT", "Sodium"])
      db.insert(labResults)
        .values({
          patientId: patient.id,
          testName,
          value: 1,
          unit: "u",
          collectedAt: "2026-10-01T08:00:00.000Z",
        })
        .run();
    llm.replyWithText("Ok.");

    await sendChat(patient.id, { message: "Labs?" });

    expect(llm.requests[0]!.messages[0]!.content).toContain(": ALT, Sodium.");
  });

  it("keeps each patient's conversation separate", async () => {
    const { body } = await testApp.request(
      "POST",
      API_ROUTES.patients,
      newPatient({ mrn: "FAKE-OTHER", firstName: "Bruno" }),
    );
    const other = PatientSchema.parse(body);
    llm.replyWithText("About Ana.").replyWithText("About Bruno.");

    await sendChat(patient.id, { message: "Question about Ana" });
    await sendChat(other.id, { message: "Question about Bruno" });

    const request = llm.requests[1]!;
    expect(request.messages.map((m) => m.content).join("\n")).not.toContain("Ana");
    expect(request.messages.at(-1)?.content).toBe("Question about Bruno");
  });

  it("reports why the model stopped, e.g. when the answer hit the token limit", async () => {
    llm.enqueue([
      { type: "text_delta", delta: "A very long answ" },
      { type: "finish", reason: "length" },
    ]);

    const { events } = await sendChat(patient.id, { message: "Explain everything" });

    expect(events.at(-1)).toMatchObject({ type: "message_end", stopReason: "length" });
    expect((await history()).at(-1)?.content).toBe("A very long answ");
  });

  describe("errors before the stream starts are plain JSON", () => {
    it.each([
      ["an empty message", { message: "   " }],
      ["a missing message", {}],
      ["a message over 8000 characters", { message: "x".repeat(8001) }],
    ])("returns 400 for %s", async (_label, body) => {
      const { status, isStream, json } = await sendChat(patient.id, body);

      expect(status).toBe(400);
      expect(isStream).toBe(false);
      expect(ApiErrorSchema.parse(json).message).toBe("Validation failed");
      expect(llm.requests).toHaveLength(0);
    });

    it("returns 404 for an unknown patient without calling the model or saving anything", async () => {
      const { status, isStream, json } = await sendChat("does-not-exist", { message: "Hi" });

      expect(status).toBe(404);
      expect(isStream).toBe(false);
      expect(ApiErrorSchema.parse(json).statusCode).toBe(404);
      expect(llm.requests).toHaveLength(0);
    });
  });

  describe("model failures", () => {
    it("streams a generic error event, keeps the question and saves no answer", async () => {
      llm.failWith(
        new LlmError("OpenRouter request failed (402): insufficient credits for sk-or-secret", {
          status: 402,
        }),
      );

      const { status, events } = await sendChat(patient.id, { message: "Hi" });

      expect(status).toBe(200);
      expect(events.map((e) => e.type)).toEqual(["message_start", "error"]);
      expect(JSON.stringify(events)).not.toContain("sk-or-secret");
      expect((await history()).map((m) => m.role)).toEqual(["user"]);
    });

    it("does not save a partial answer when the model fails midway", async () => {
      llm.failWith(new LlmError("Provider disconnected", { status: 502 }), [
        { type: "text_delta", delta: "Her hemo" },
      ]);

      const { events } = await sendChat(patient.id, { message: "Labs?" });

      expect(events.map((e) => e.type)).toEqual(["message_start", "text_delta", "error"]);
      expect((await history()).map((m) => m.role)).toEqual(["user"]);
    });

    it("lets the patient's chat continue after a failure", async () => {
      llm.failWith(new LlmError("timeout")).replyWithText("Recovered.");

      await sendChat(patient.id, { message: "First try" });
      const { events } = await sendChat(patient.id, { message: "Second try" });

      expect(answerText(events)).toBe("Recovered.");
      expect((await history()).map((m) => m.content)).toEqual([
        "First try",
        "Second try",
        "Recovered.",
      ]);
    });
  });

  it("stops the model and saves no answer when the client disconnects", async () => {
    llm.replyThenHang("Still thinking about");
    const controller = new AbortController();

    const response = await fetch(`${testApp.url}${API_ROUTES.patientChat(patient.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Long question" }),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    let received = "";
    while (!received.includes("Still thinking about"))
      received += new TextDecoder().decode((await reader.read()).value);
    controller.abort();

    await expect.poll(() => llm.lastSignal?.aborted, { timeout: 2000 }).toBe(true);
    expect((await history()).map((m) => m.role)).toEqual(["user"]);
  });
});
