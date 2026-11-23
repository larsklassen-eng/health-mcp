import {
  API_ROUTES,
  ApiErrorSchema,
  ChatHistoryResponseSchema,
  type ChatStreamEvent,
  ChatStreamEventSchema,
  type Patient,
  PatientSchema,
  ToolCallSchema,
} from "@health-mcp/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { AWAITING_CONFIRMATION } from "../src/chat/agent.service.js";
import { LlmClient } from "../src/llm/llm-client.js";
import { McpClient } from "../src/mcp/mcp-client.js";
import { FakeLlmClient } from "./fakes/fake-llm-client.js";
import { FakeMcpClient } from "./fakes/fake-mcp-client.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
let llm: FakeLlmClient;
let mcp: FakeMcpClient;
let patient: Patient;

const SAVED = {
  symptom: { name: "Headache", severity: 4, recordedAt: "2026-10-19T09:30:00.000Z" },
};
/** What a dry run of the headache entry returns, as the MCP server's log_symptom does. */
const PREVIEW = [
  { field: "symptom", after: "Headache" },
  { field: "severity", after: "4/10" },
];
const dryRunOr = (saved: () => unknown) => (_args: unknown, _id: string, options: object) =>
  "dryRun" in options
    ? { output: { changes: PREVIEW }, isError: false }
    : { output: saved(), isError: false };

beforeEach(async () => {
  llm = new FakeLlmClient();
  mcp = new FakeMcpClient().offer(
    "log_symptom",
    dryRunOr(() => SAVED),
  );
  testApp = await startTestApp(AppModule, [
    { provide: LlmClient, useValue: llm },
    { provide: McpClient, useValue: mcp },
  ]);
  const { body } = await testApp.request("POST", API_ROUTES.patients, newPatient());
  patient = PatientSchema.parse(body);
});
afterEach(async () => {
  await testApp.close();
});

async function sendChat(message: string): Promise<ChatStreamEvent[]> {
  const response = await fetch(`${testApp.url}${API_ROUTES.patientChat(patient.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return (await response.text())
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => ChatStreamEventSchema.parse(JSON.parse(block.slice("data: ".length))));
}

async function savedToolCall(id = "t1") {
  const { body } = await testApp.request("GET", API_ROUTES.patientChat(patient.id));
  return ChatHistoryResponseSchema.parse(body)
    .messages.flatMap((m) => m.toolCalls)
    .find((call) => call.id === id);
}

const decide = (decision: string, toolCallId = "t1") =>
  testApp.request("POST", API_ROUTES.toolCallDecision(patient.id, toolCallId), { decision });

/** Calls that saved something (not dry runs). */
const saves = () => mcp.calls.filter((call) => !call.dryRun);

/** The model asks to log a headache, then answers. */
async function proposeHeadache() {
  llm
    .replyWithToolCalls({
      id: "t1",
      name: "log_symptom",
      arguments: { name: "Headache", severity: 4 },
    })
    .replyWithText("Please confirm the headache entry.");
  return sendChat("Log a headache, severity 4.");
}

describe("tools that need the clinician's confirmation", () => {
  it("only previews log_symptom when the model calls it, and marks it pending", async () => {
    const events = await proposeHeadache();

    expect(mcp.calls).toEqual([
      {
        patientId: patient.id,
        name: "log_symptom",
        args: { name: "Headache", severity: 4 },
        dryRun: true,
      },
    ]);
    const message =
      `${AWAITING_CONFIRMATION}\nThe change, as the clinician sees it:\n` +
      "- symptom: Headache\n- severity: 4/10";
    expect(events.find((e) => e.type === "tool_call_result")).toEqual({
      type: "tool_call_result",
      toolCallId: "t1",
      output: message,
      isError: false,
      confirmation: "pending",
      preview: PREVIEW,
    });
    const toolMessage = llm.requests[1]!.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toBe(message);
    expect(await savedToolCall()).toMatchObject({
      name: "log_symptom",
      input: { name: "Headache", severity: 4 },
      confirmation: "pending",
      preview: PREVIEW,
    });
  });

  it("returns a change the MCP server would refuse to the model, with no card", async () => {
    mcp.offer("log_symptom", () => ({ output: "Patient p9 not found.", isError: true }));

    const events = await proposeHeadache();

    expect(events.find((e) => e.type === "tool_call_result")).toEqual({
      type: "tool_call_result",
      toolCallId: "t1",
      output: "Patient p9 not found.",
      isError: true,
    });
    expect((await savedToolCall())?.confirmation).toBeUndefined();
    expect(saves()).toEqual([]);
  });

  it("runs the tool once the clinician confirms, and saves the result", async () => {
    await proposeHeadache();

    const { status, body } = await decide("confirm");

    expect(status).toBe(200);
    const expected = {
      id: "t1",
      name: "log_symptom",
      input: { name: "Headache", severity: 4 },
      output: SAVED,
      isError: false,
      confirmation: "confirmed",
      preview: PREVIEW,
    };
    expect(ToolCallSchema.parse(body)).toEqual(expected);
    // Previewed when proposed, previewed again to check it still holds, then saved.
    expect(mcp.calls.map((call) => call.dryRun ?? false)).toEqual([true, true, false]);
    expect(saves()).toEqual([
      { patientId: patient.id, name: "log_symptom", args: { name: "Headache", severity: 4 } },
    ]);
    expect(await savedToolCall()).toEqual(expected);
  });

  it("does not run the tool when the clinician discards it", async () => {
    await proposeHeadache();

    const { status, body } = await decide("reject");

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: "t1", confirmation: "rejected" });
    expect(saves()).toEqual([]);
    expect((await savedToolCall())?.confirmation).toBe("rejected");
  });

  it("cannot decide twice, so a symptom is never saved twice", async () => {
    await proposeHeadache();
    await decide("confirm");

    const again = await decide("confirm");
    const reject = await decide("reject");

    expect(again.status).toBe(409);
    expect(reject.status).toBe(409);
    expect(saves()).toHaveLength(1);
  });

  it("saves nothing when the record changed since the preview", async () => {
    await proposeHeadache();
    mcp.offer("log_symptom", (_args, _id, options) => ({
      output: options.dryRun
        ? { changes: [{ field: "symptom", before: "Migraine", after: "Headache" }, PREVIEW[1]] }
        : SAVED,
      isError: false,
    }));

    const { status, body } = await decide("confirm");

    expect(status).toBe(409);
    expect(ApiErrorSchema.parse(body).message).toBe(
      "The record changed since this was proposed (symptom is now Migraine, not empty). " +
        "Nothing was saved; discard it and ask again.",
    );
    expect(saves()).toEqual([]);
    expect((await savedToolCall())?.confirmation).toBe("pending");
  });

  it("saves only once when confirm is sent twice at the same time", async () => {
    let finish!: () => void;
    mcp.offer("log_symptom", (_args, _id, options) =>
      options.dryRun
        ? { output: { changes: PREVIEW }, isError: false }
        : new Promise((resolve) => {
            finish = () => resolve({ output: SAVED, isError: false });
          }),
    );
    await proposeHeadache();

    const first = decide("confirm");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await decide("confirm");
    finish();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
    expect(saves()).toHaveLength(1);
  });

  it("keeps the entry pending when the MCP server fails, so it can be retried", async () => {
    await proposeHeadache();
    mcp.offer("log_symptom", () => {
      throw new Error("connect ECONNREFUSED");
    });

    const unavailable = await decide("confirm");
    expect(unavailable.status).toBe(503);
    expect(ApiErrorSchema.parse(unavailable.body).message).toContain("Nothing was saved");

    mcp.offer("log_symptom", () => ({ output: "Patient not found.", isError: true }));
    const toolError = await decide("confirm");
    expect(toolError.status).toBe(502);
    expect(ApiErrorSchema.parse(toolError.body).message).toBe(
      "Nothing was saved: Patient not found.",
    );

    expect((await savedToolCall())?.confirmation).toBe("pending");
  });

  it("tells the model in later turns what the clinician decided", async () => {
    await proposeHeadache();
    await decide("confirm");
    llm.replyWithText("Noted.");

    await sendChat("Thanks");

    const assistant = llm.requests[2]!.messages.filter((m) => m.role === "assistant").at(-1);
    expect(assistant?.content).toBe(
      "Please confirm the headache entry.\n\n" +
        '[The clinician confirmed and saved: log_symptom {"name":"Headache","severity":4}]',
    );
  });

  it("returns 404 for an unknown tool call and 409 for one that needs no decision", async () => {
    mcp.offer("get_patient_profile");
    llm
      .replyWithToolCalls({ id: "t2", name: "get_patient_profile", arguments: {} })
      .replyWithText("Done.");
    await sendChat("Profile?");

    expect((await decide("confirm", "nope")).status).toBe(404);
    expect((await decide("confirm", "t2")).status).toBe(409);
  });

  it("returns 400 for an invalid decision", async () => {
    await proposeHeadache();
    expect((await decide("maybe")).status).toBe(400);
  });
});
