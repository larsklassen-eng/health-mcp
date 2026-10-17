import type { ChatMessage } from "@health-mcp/shared";
import { describe, expect, it } from "vitest";

import { recentHistory } from "../src/chat/history-window.js";

const message = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: `${role}-${content}`,
  patientId: "p1",
  role,
  content,
  toolCalls: [],
  createdAt: "2026-10-01T10:00:00.000Z",
});
const contents = (messages: ChatMessage[]) => messages.map((m) => m.content);

// Four messages of 10 characters each.
const chat = [
  message("user", "question 1"),
  message("assistant", "answer 01."),
  message("user", "question 2"),
  message("assistant", "answer 02."),
];

describe("recentHistory", () => {
  it("keeps everything that fits", () => {
    expect(recentHistory(chat, 40)).toEqual({ messages: chat, omitted: 0 });
    expect(recentHistory([], 40)).toEqual({ messages: [], omitted: 0 });
  });

  it("keeps the newest whole messages that fit", () => {
    const { messages, omitted } = recentHistory(chat, 29);

    expect(contents(messages)).toEqual(["question 2", "answer 02."]);
    expect(omitted).toBe(2);
  });

  it("never starts with an answer whose question was left out", () => {
    // 30 characters would fit "answer 01.", but not its question.
    expect(contents(recentHistory(chat, 30).messages)).toEqual(["question 2", "answer 02."]);
  });

  it("sends nothing when even the latest message is too long", () => {
    const long = [message("user", "x".repeat(50))];

    expect(recentHistory(long, 40)).toEqual({ messages: [], omitted: 1 });
  });
});
