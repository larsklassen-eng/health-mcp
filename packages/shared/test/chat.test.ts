import { describe, expect, it } from "vitest";

import {
  ChatMessageSchema,
  ChatStreamEventSchema,
  SendChatMessageRequestSchema,
} from "../src/index.js";

describe("SendChatMessageRequestSchema", () => {
  it("trims the message", () => {
    expect(SendChatMessageRequestSchema.parse({ message: "  How is she doing?  " }).message).toBe(
      "How is she doing?",
    );
  });

  it.each([
    ["an empty message", ""],
    ["a whitespace-only message", "   "],
    ["a message over 8000 characters", "x".repeat(8001)],
  ])("rejects %s", (_label, message) => {
    expect(SendChatMessageRequestSchema.safeParse({ message }).success).toBe(false);
  });
});

describe("ChatStreamEventSchema", () => {
  it.each([
    { type: "message_start", messageId: "m1" },
    { type: "text_delta", delta: "Hello" },
    { type: "tool_call_start", toolCallId: "t1", name: "get_lab_results", input: { limit: 5 } },
    { type: "tool_call_result", toolCallId: "t1", output: [{ value: 1 }], isError: false },
    { type: "message_end", messageId: "m1", stopReason: "end_turn" },
    { type: "error", message: "Upstream timeout" },
  ])("accepts a $type event", (event) => {
    expect(ChatStreamEventSchema.parse(event)).toEqual(event);
  });

  it("rejects unknown event types", () => {
    expect(ChatStreamEventSchema.safeParse({ type: "thinking", delta: "..." }).success).toBe(false);
  });

  it("rejects events missing their payload", () => {
    expect(ChatStreamEventSchema.safeParse({ type: "text_delta" }).success).toBe(false);
  });
});

describe("ChatMessageSchema", () => {
  it("defaults toolCalls and isError", () => {
    const message = ChatMessageSchema.parse({
      id: "m1",
      patientId: "p1",
      role: "assistant",
      content: "Hi",
      createdAt: "2026-10-12T10:00:00Z",
    });
    expect(message.toolCalls).toEqual([]);

    const withTool = ChatMessageSchema.parse({
      ...message,
      toolCalls: [{ id: "t1", name: "get_medications", input: {} }],
    });
    expect(withTool.toolCalls[0]?.isError).toBe(false);
  });
});
