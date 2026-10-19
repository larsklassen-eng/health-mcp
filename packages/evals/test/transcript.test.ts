import type { ChatStreamEvent } from "@health-mcp/shared";
import { describe, expect, it } from "vitest";

import { parseChatStream } from "../src/index.js";

const sse = (...events: ChatStreamEvent[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

describe("parseChatStream", () => {
  it("collects the answer, the tool calls with their outcome, and the stop reason", () => {
    const body = sse(
      { type: "message_start", messageId: "a1" },
      { type: "text_delta", delta: "Let me check. " },
      { type: "tool_call_start", toolCallId: "t1", name: "get_lab_results", input: { limit: 5 } },
      { type: "tool_call_start", toolCallId: "t2", name: "get_medications", input: {} },
      { type: "tool_call_result", toolCallId: "t2", output: "Patient not found.", isError: true },
      { type: "tool_call_result", toolCallId: "t1", output: { results: [] }, isError: false },
      { type: "text_delta", delta: "No results." },
      {
        type: "message_end",
        messageId: "a1",
        stopReason: "stop",
        usage: { modelCalls: 2, inputTokens: 900, outputTokens: 40, costUsd: 0.012 },
      },
    );

    expect(parseChatStream(body)).toEqual({
      answer: "Let me check. No results.",
      toolCalls: [
        { name: "get_lab_results", input: { limit: 5 }, isError: false },
        { name: "get_medications", input: {}, isError: true },
      ],
      stopReason: "stop",
      usage: { modelCalls: 2, inputTokens: 900, outputTokens: 40, costUsd: 0.012 },
    });
  });

  it("reports an error event", () => {
    const body = sse(
      { type: "message_start", messageId: "a1" },
      { type: "error", message: "The assistant could not answer. Please try again." },
    );

    expect(parseChatStream(body).error).toBe("The assistant could not answer. Please try again.");
  });

  it("reports a stream that ends without an answer", () => {
    const body = sse(
      { type: "message_start", messageId: "a1" },
      { type: "text_delta", delta: "Cu" },
    );

    expect(parseChatStream(body)).toMatchObject({
      answer: "Cu",
      error: "The stream ended without an answer.",
    });
  });
});
