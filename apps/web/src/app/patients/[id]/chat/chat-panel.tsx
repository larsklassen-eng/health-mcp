"use client";

import type { ChatMessage, ToolCall } from "@health-mcp/shared";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";

import { ChatSendError, GENERIC_SEND_ERROR, sendChatMessage } from "@/lib/chat-client";

import { ChatTranscript } from "./chat-transcript";

const MAX_MESSAGE_LENGTH = 8000;

interface Props {
  patientId: string;
  initialMessages: ChatMessage[];
}

/** The live chat: history, the answer being streamed, and the message box. */
export function ChatPanel({ patientId, initialMessages }: Props) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState<string | null>(null); // the answer while it streams
  const [draftCalls, setDraftCalls] = useState<ToolCall[]>([]);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streaming = draft !== null;

  const now = () => new Date().toISOString();

  async function send(text: string) {
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setNotice(null);
    setInput("");
    // The api saves the question before answering, so it stays even if the answer fails.
    setMessages((m) => [
      ...m,
      {
        id: `local-${crypto.randomUUID()}`,
        patientId,
        role: "user",
        content: text,
        toolCalls: [],
        createdAt: now(),
      },
    ]);
    setDraft("");
    setDraftCalls([]);
    setRunning(new Set());

    let answer = "";
    let calls: ToolCall[] = [];
    let finished = false;
    try {
      const events = await sendChatMessage(patientId, text, abort.signal);
      for await (const event of events) {
        if (event.type === "text_delta") {
          answer += event.delta;
          setDraft(answer);
        } else if (event.type === "tool_call_start") {
          calls = [
            ...calls,
            { id: event.toolCallId, name: event.name, input: event.input, isError: false },
          ];
          setDraftCalls(calls);
          setRunning((ids) => new Set(ids).add(event.toolCallId));
        } else if (event.type === "tool_call_result") {
          const { toolCallId, output, isError } = event;
          calls = calls.map((call) =>
            call.id === toolCallId ? { ...call, output, isError } : call,
          );
          setDraftCalls(calls);
          setRunning((ids) => {
            const next = new Set(ids);
            next.delete(toolCallId);
            return next;
          });
        } else if (event.type === "message_end") {
          finished = true;
          const toolCalls = calls;
          setMessages((m) => [
            ...m,
            {
              id: event.messageId,
              patientId,
              role: "assistant",
              content: answer,
              toolCalls,
              createdAt: now(),
            },
          ]);
        } else if (event.type === "error") {
          finished = true;
          setError(event.message);
        }
      }
      if (!finished) setError(GENERIC_SEND_ERROR); // the stream ended without an answer
    } catch (caught) {
      // The api does not save a stopped answer, so it is dropped here too.
      if (abort.signal.aborted) setNotice("Answer stopped. It was not saved.");
      else setError(caught instanceof ChatSendError ? caught.message : GENERIC_SEND_ERROR);
    } finally {
      abortRef.current = null;
      setDraft(null);
      setDraftCalls([]);
      setRunning(new Set());
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (text && !streaming) void send(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const shown: ChatMessage[] =
    draft === null
      ? messages
      : [
          ...messages,
          {
            id: "draft",
            patientId,
            role: "assistant",
            content: draft || "…",
            toolCalls: draftCalls,
            createdAt: now(),
          },
        ];

  return (
    <>
      <div aria-busy={streaming}>
        <ChatTranscript messages={shown} runningToolCalls={running} />
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}

      <form className="chat-form" onSubmit={onSubmit}>
        <label htmlFor="chat-message" className="visually-hidden">
          Message
        </label>
        <textarea
          id="chat-message"
          name="message"
          rows={3}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Ask about this patient's recovery…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={streaming}
        />
        <div className="chat-form-actions">
          <p className="muted chat-disclaimer">
            For learning only, with synthetic data. Not medical advice.
          </p>
          {streaming ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          ) : (
            <button type="submit" className="button" disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </>
  );
}
