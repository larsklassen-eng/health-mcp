import {
  API_ROUTES,
  ChatHistoryResponseSchema,
  type ChatStreamEvent,
  ChatStreamEventSchema,
  MCP_TOOLS,
  type Patient,
  PatientSchema,
} from "@health-mcp/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { MAX_TOOL_ROUNDS } from "../src/chat/agent.service.js";
import { LlmClient, LlmError, type LlmMessage } from "../src/llm/llm-client.js";
import { McpClient } from "../src/mcp/mcp-client.js";
import { FakeLlmClient } from "./fakes/fake-llm-client.js";
import { FakeMcpClient } from "./fakes/fake-mcp-client.js";
import { newPatient } from "./fixtures.js";
import { startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
let llm: FakeLlmClient;
let mcp: FakeMcpClient;
let patient: Patient;

beforeEach(async () => {
  llm = new FakeLlmClient();
  mcp = new FakeMcpClient();
  testApp = await startTestApp(AppModule, [
    { provide: LlmClient, useValue: llm },
    { provide: McpClient, useValue: mcp },
  ]);
  const { body } = await testApp.request(
    "POST",
    API_ROUTES.patients,
    newPatient({ firstName: "Ana", lastName: "Test" }),
  );
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

const answerText = (events: ChatStreamEvent[]) =>
  events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : [])).join("");

const toolResults = (events: ChatStreamEvent[]) =>
  events.filter((event) => event.type === "tool_call_result");

async function history() {
  const { body } = await testApp.request("GET", API_ROUTES.patientChat(patient.id));
  return ChatHistoryResponseSchema.parse(body).messages;
}

/** The tool message the model received for `toolCallId` in request `index`. */
const toolMessage = (index: number, toolCallId: string) =>
  llm.requests[index]?.messages.find(
    (m): m is Extract<LlmMessage, { role: "tool" }> =>
      m.role === "tool" && m.toolCallId === toolCallId,
  );

describe("chat with tools", () => {
  it("offers the MCP server's tools with the shared descriptions and without patient_id", async () => {
    mcp.offer("get_patient_profile").offer("get_lab_results");
    llm.replyWithText("Hi.");

    await sendChat("Hi");

    const tools = llm.requests[0]!.tools!;
    expect(tools.map((t) => t.name)).toEqual(["get_patient_profile", "get_lab_results"]);
    expect(tools[0]).toEqual({
      name: "get_patient_profile",
      description: MCP_TOOLS.get_patient_profile.description,
      parameters: { type: "object", properties: {} },
    });
    expect(tools[1]!.parameters).toMatchObject({
      type: "object",
      properties: { test_names: { type: "array", items: { type: "string" } } },
    });
    expect(JSON.stringify(tools)).not.toContain("patient_id");
  });

  it("only offers tools that are in the shared contract", async () => {
    mcp.offer("get_patient_profile").offer("delete_everything");
    llm.replyWithText("Hi.");

    await sendChat("Hi");

    expect(llm.requests[0]!.tools!.map((t) => t.name)).toEqual(["get_patient_profile"]);
  });

  it("runs a tool for the chat's patient, returns the result to the model and streams both", async () => {
    mcp.offer("get_patient_profile", (_args, patientId) => ({
      output: { id: patientId, diagnosis: "Synthetic meningioma" },
      isError: false,
    }));
    llm
      .replyWithToolCalls({ id: "call_1", name: "get_patient_profile", arguments: {} })
      .replyWithText("She has a synthetic meningioma.");

    const events = await sendChat("What is her diagnosis?");

    expect(mcp.calls).toEqual([{ patientId: patient.id, name: "get_patient_profile", args: {} }]);
    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "tool_call_start",
      "tool_call_result",
      ...Array(events.length - 4).fill("text_delta"),
      "message_end",
    ]);
    expect(events[1]).toEqual({
      type: "tool_call_start",
      toolCallId: "call_1",
      name: "get_patient_profile",
      input: {},
    });
    expect(events[2]).toEqual({
      type: "tool_call_result",
      toolCallId: "call_1",
      output: { id: patient.id, diagnosis: "Synthetic meningioma" },
      isError: false,
    });
    expect(answerText(events)).toBe("She has a synthetic meningioma.");

    const second = llm.requests[1]!.messages;
    expect(second.at(-2)).toEqual({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "get_patient_profile", arguments: "{}" }],
    });
    expect(second.at(-1)).toEqual({
      role: "tool",
      toolCallId: "call_1",
      content: JSON.stringify({ id: patient.id, diagnosis: "Synthetic meningioma" }),
    });
  });

  it("saves the tool calls with the answer", async () => {
    mcp.offer("get_lab_results", () => ({
      output: [{ testName: "Hemoglobin", value: 11.2 }],
      isError: false,
    }));
    llm
      .replyWithToolCalls({
        id: "call_1",
        name: "get_lab_results",
        arguments: { test_names: ["Hemoglobin"] },
      })
      .replyWithText("Hemoglobin is 11.2.");

    await sendChat("Hemoglobin?");

    const saved = (await history()).at(-1)!;
    expect(saved).toMatchObject({ role: "assistant", content: "Hemoglobin is 11.2." });
    expect(saved.toolCalls).toEqual([
      {
        id: "call_1",
        name: "get_lab_results",
        input: { test_names: ["Hemoglobin"], limit: 20 },
        output: [{ testName: "Hemoglobin", value: 11.2 }],
        isError: false,
      },
    ]);
  });

  it("ignores a patient_id chosen by the model", async () => {
    mcp.offer("get_patient_profile");
    llm
      .replyWithToolCalls({
        id: "call_1",
        name: "get_patient_profile",
        arguments: { patient_id: "someone-else" },
      })
      .replyWithText("Done.");

    const events = await sendChat("Show me another patient");

    expect(mcp.calls).toEqual([{ patientId: patient.id, name: "get_patient_profile", args: {} }]);
    // Neither the stream nor the saved history suggests another patient was read.
    expect(events.find((e) => e.type === "tool_call_start")).toMatchObject({ input: {} });
    expect((await history()).at(-1)!.toolCalls[0]!.input).toEqual({});
  });

  it("passes the validated arguments, with defaults applied", async () => {
    mcp.offer("get_lab_results");
    llm
      .replyWithToolCalls({
        id: "call_1",
        name: "get_lab_results",
        arguments: { test_names: ["Hemoglobin"] },
      })
      .replyWithText("Done.");

    await sendChat("Labs?");

    expect(mcp.calls[0]!.args).toEqual({ test_names: ["Hemoglobin"], limit: 20 });
  });

  it("shows the rejected arguments, without patient_id, when they fail validation", async () => {
    mcp.offer("get_lab_results");
    llm
      .replyWithToolCalls({
        id: "call_1",
        name: "get_lab_results",
        arguments: { limit: 500, patient_id: "x" },
      })
      .replyWithText("Sorry.");

    const events = await sendChat("Labs?");

    expect(events.find((e) => e.type === "tool_call_start")).toMatchObject({
      input: { limit: 500 },
    });
  });

  it("runs several tool calls from one turn in order", async () => {
    mcp.offer("get_patient_profile").offer("get_lab_results");
    llm
      .replyWithToolCalls(
        { id: "call_1", name: "get_patient_profile", arguments: {} },
        { id: "call_2", name: "get_lab_results", arguments: {} },
      )
      .replyWithText("Done.");

    const events = await sendChat("Everything?");

    expect(mcp.calls.map((c) => c.name)).toEqual(["get_patient_profile", "get_lab_results"]);
    expect(toolResults(events).map((e) => e.toolCallId)).toEqual(["call_1", "call_2"]);
    expect(llm.requests[1]!.messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("separates text written before and after tool calls", async () => {
    mcp.offer("get_patient_profile");
    llm
      .enqueue([
        { type: "text_delta", delta: "Let me check." },
        { type: "tool_call", call: { id: "call_1", name: "get_patient_profile", arguments: "{}" } },
        { type: "finish", reason: "tool_calls" },
      ])
      .replyWithText("Here it is.");

    const events = await sendChat("Profile?");

    expect(answerText(events)).toBe("Let me check.\n\nHere it is.");
    expect((await history()).at(-1)!.content).toBe("Let me check.\n\nHere it is.");
    expect(llm.requests[1]!.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: "Let me check.",
    });
  });

  it("sends only the text of earlier answers in the next turn, not their tool calls", async () => {
    mcp.offer("get_patient_profile");
    llm
      .replyWithToolCalls({ id: "call_1", name: "get_patient_profile", arguments: {} })
      .replyWithText("First answer.")
      .replyWithText("Second answer.");

    await sendChat("First question");
    await sendChat("Second question");

    expect(llm.requests[2]!.messages.slice(1)).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer." },
      { role: "user", content: "Second question" },
    ]);
  });

  describe("tool problems are reported to the model, which answers anyway", () => {
    it("returns the tool's own error result", async () => {
      mcp.offer("get_patient_profile", () => ({ output: "Patient p1 not found.", isError: true }));
      llm
        .replyWithToolCalls({ id: "call_1", name: "get_patient_profile", arguments: {} })
        .replyWithText("I could not load the profile.");

      const events = await sendChat("Profile?");

      expect(toolResults(events)[0]).toMatchObject({
        isError: true,
        output: "Patient p1 not found.",
      });
      expect(toolMessage(1, "call_1")?.content).toBe("Error: Patient p1 not found.");
      expect(events.at(-1)?.type).toBe("message_end");
    });

    it("rejects a tool that was not offered without calling the MCP server", async () => {
      mcp.offer("get_patient_profile");
      llm
        .replyWithToolCalls({ id: "call_1", name: "get_lab_results", arguments: {} })
        .replyWithText("Sorry.");

      const events = await sendChat("Labs?");

      expect(mcp.calls).toEqual([]);
      expect(toolResults(events)[0]).toMatchObject({
        isError: true,
        output: expect.stringContaining('Unknown tool "get_lab_results"'),
      });
    });

    it.each([
      ["arguments that are not JSON", "{not json", "The arguments must be a JSON object."],
      ["arguments that are not an object", "[1, 2]", "The arguments must be a JSON object."],
      [
        "arguments that fail the shared schema",
        JSON.stringify({ limit: 500 }),
        "Invalid arguments",
      ],
    ])("rejects %s without calling the MCP server", async (_, args, message) => {
      mcp.offer("get_lab_results");
      llm
        .enqueue([
          { type: "tool_call", call: { id: "call_1", name: "get_lab_results", arguments: args } },
          { type: "finish", reason: "tool_calls" },
        ])
        .replyWithText("Sorry.");

      const events = await sendChat("Labs?");

      expect(mcp.calls).toEqual([]);
      expect(toolResults(events)[0]).toMatchObject({
        isError: true,
        output: expect.stringContaining(message),
      });
      expect(toolMessage(1, "call_1")?.content).toContain(message);
    });

    it("reports an MCP server that fails during the call as unavailable", async () => {
      mcp.offer("get_patient_profile", () => {
        throw new Error("socket hang up");
      });
      llm
        .replyWithToolCalls({ id: "call_1", name: "get_patient_profile", arguments: {} })
        .replyWithText("The tool is down.");

      const events = await sendChat("Profile?");

      expect(toolResults(events)[0]).toMatchObject({
        isError: true,
        output: "The tool is unavailable right now.",
      });
      expect(JSON.stringify(events)).not.toContain("socket hang up");
      expect(events.at(-1)?.type).toBe("message_end");
    });
  });

  it("answers without tools when the MCP server cannot be reached", async () => {
    mcp.failListing();
    llm.replyWithText("I can only see the profile.");

    const events = await sendChat("Labs?");

    expect(llm.requests[0]!.tools).toBeUndefined();
    expect(answerText(events)).toBe("I can only see the profile.");
  });

  it(`stops a model that keeps calling tools after ${MAX_TOOL_ROUNDS} rounds`, async () => {
    mcp.offer("get_patient_profile");
    for (let i = 0; i <= MAX_TOOL_ROUNDS; i++)
      llm.replyWithToolCalls({ id: `call_${i}`, name: "get_patient_profile", arguments: {} });

    const events = await sendChat("Loop forever");

    expect(mcp.calls).toHaveLength(MAX_TOOL_ROUNDS);
    expect(llm.requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(events.at(-1)).toMatchObject({ type: "message_end", stopReason: "max_tool_rounds" });
    expect((await history()).at(-1)!.toolCalls).toHaveLength(MAX_TOOL_ROUNDS);
  });

  it("gives tool calls a valid id when the provider's id is missing or too long", async () => {
    mcp.offer("get_patient_profile");
    llm
      .replyWithToolCalls(
        { id: "", name: "get_patient_profile", arguments: {} },
        { id: "x".repeat(100), name: "get_patient_profile", arguments: {} },
      )
      .replyWithText("Done.");

    const events = await sendChat("Profile?");

    const ids = toolResults(events).map((e) => e.toolCallId);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    // The model still gets its own ids back.
    expect(
      llm.requests[1]!.messages.filter((m) => m.role === "tool").map((m) => m.toolCallId),
    ).toEqual(["", "x".repeat(100)]);
  });

  it("saves no answer when the model fails after a tool ran", async () => {
    mcp.offer("get_patient_profile");
    llm
      .replyWithToolCalls({ id: "call_1", name: "get_patient_profile", arguments: {} })
      .failWith(new LlmError("Provider error", { status: 502 }));

    const events = await sendChat("Profile?");

    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "tool_call_start",
      "tool_call_result",
      "error",
    ]);
    expect((await history()).map((m) => m.role)).toEqual(["user"]);
  });

  it("stops the tool call and saves nothing when the client disconnects during it", async () => {
    let toolSignal: AbortSignal | undefined;
    mcp.offer("get_patient_profile", (_args, _patientId, signal) => {
      toolSignal = signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
      );
    });
    llm.replyWithToolCalls({ id: "call_1", name: "get_patient_profile", arguments: {} });
    const controller = new AbortController();

    const response = await fetch(`${testApp.url}${API_ROUTES.patientChat(patient.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Profile?" }),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    let received = "";
    while (!received.includes("tool_call_start"))
      received += new TextDecoder().decode((await reader.read()).value);
    controller.abort();

    await expect.poll(() => toolSignal?.aborted, { timeout: 2000 }).toBe(true);
    expect((await history()).map((m) => m.role)).toEqual(["user"]);
  });
});

describe("usage", () => {
  it("reports the tokens and cost of all of an answer's model calls in message_end", async () => {
    mcp.offer("get_lab_results");
    llm
      .enqueue([
        {
          type: "tool_call",
          call: { id: "t1", name: "get_lab_results", arguments: "{}" },
        },
        {
          type: "finish",
          reason: "tool_calls",
          usage: { inputTokens: 1000, outputTokens: 20, costUsd: 0.01 },
        },
      ])
      .enqueue([
        { type: "text_delta", delta: "Labs are fine." },
        {
          type: "finish",
          reason: "stop",
          usage: { inputTokens: 1500, outputTokens: 30, cachedInputTokens: 900, costUsd: 0.02 },
        },
      ]);

    const events = await sendChat("Labs?");

    const end = events.at(-1);
    expect(end?.type === "message_end" && end.usage).toEqual({
      modelCalls: 2,
      inputTokens: 2500,
      outputTokens: 50,
      cachedInputTokens: 900,
      costUsd: expect.closeTo(0.03, 10),
    });
  });

  it("counts model calls even when the provider reports no usage", async () => {
    llm.replyWithText("Hi.");

    const events = await sendChat("Hi");

    expect(events.at(-1)).toMatchObject({
      type: "message_end",
      usage: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
    });
    const end = events.at(-1);
    expect(end?.type === "message_end" && end.usage).not.toHaveProperty("costUsd");
  });
});
