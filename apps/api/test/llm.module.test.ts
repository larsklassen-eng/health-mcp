import { describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { LlmClient, LlmError } from "../src/llm/llm-client.js";
import { OpenRouterLlmClient } from "../src/llm/openrouter-llm-client.js";
import { collect, FakeLlmClient } from "./fakes/fake-llm-client.js";
import { startTestApp } from "./helpers.js";

describe("LlmModule", () => {
  it("lets the app start without an API key and provides the OpenRouter client", async () => {
    const testApp = await startTestApp(AppModule);
    try {
      const client = testApp.app.get(LlmClient);

      expect(client).toBeInstanceOf(OpenRouterLlmClient);
      expect(client.model).toBe("anthropic/claude-opus-5.5");
      await expect(
        collect(client.stream({ messages: [{ role: "user", content: "Hi" }] })),
      ).rejects.toThrow("OPENROUTER_API_KEY is not set");
    } finally {
      await testApp.close();
    }
  });
});

describe("FakeLlmClient", () => {
  it("replays scripted turns in order and records each request", async () => {
    const fake = new FakeLlmClient()
      .replyWithToolCalls({ id: "t1", name: "get_lab_results", arguments: { limit: 5 } })
      .replyWithText("Hemoglobin is low.");

    const first = await collect(fake.stream({ messages: [{ role: "user", content: "Labs?" }] }));
    const second = await collect(fake.stream({ messages: [{ role: "user", content: "And?" }] }));

    expect(first).toEqual([
      { type: "tool_call", call: { id: "t1", name: "get_lab_results", arguments: '{"limit":5}' } },
      { type: "finish", reason: "tool_calls" },
    ]);
    expect(
      second
        .filter((e) => e.type === "text_delta")
        .map((e) => e.delta)
        .join(""),
    ).toBe("Hemoglobin is low.");
    expect(fake.requests.map((r) => r.messages[0]?.content)).toEqual(["Labs?", "And?"]);
    expect(fake.remainingTurns).toBe(0);
  });

  it("can fail a turn, and refuses unscripted requests", async () => {
    const fake = new FakeLlmClient().failWith(new LlmError("rate limited", { status: 429 }));

    await expect(collect(fake.stream({ messages: [] }))).rejects.toMatchObject({ status: 429 });
    await expect(collect(fake.stream({ messages: [] }))).rejects.toThrow("did not script a turn");
  });
});
