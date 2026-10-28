import type { ChatMessage } from "@health-mcp/shared";

import { messageAnchor } from "@/lib/anchors";

import { ChatMarkdown } from "./chat-markdown";
import { ChatToolCalls } from "./chat-tool-calls";
import type { DecideToolCall } from "./tool-call-confirmation";

const ROLE_LABELS: Record<ChatMessage["role"], string> = { user: "You", assistant: "Assistant" };

/** Formatted in UTC so server and browser render the same text. */
const timeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

interface Props {
  messages: ChatMessage[];
  /** Tool calls still waiting for their result (only in the answer being streamed). */
  runningToolCalls?: ReadonlySet<string>;
  /** Saves or discards entries the assistant proposed (see `ChatToolCalls`). */
  onDecide?: DecideToolCall;
  decisionsDisabled?: boolean;
}

export function ChatTranscript({ messages, runningToolCalls, onDecide, decisionsDisabled }: Props) {
  if (messages.length === 0) {
    return (
      <div className="card">
        <p className="muted">No messages yet.</p>
      </div>
    );
  }

  return (
    <ol className="chat" aria-label="Chat messages">
      {messages.map((message) => (
        <li
          key={message.id}
          id={messageAnchor(message.id)}
          className={`chat-message ${message.role}`}
        >
          <div className="chat-meta">
            <strong>{ROLE_LABELS[message.role]}</strong>{" "}
            <time dateTime={message.createdAt}>
              {timeFormat.format(new Date(message.createdAt))} UTC
            </time>
          </div>
          {message.role === "assistant" && (
            <ChatToolCalls
              patientId={message.patientId}
              calls={message.toolCalls}
              {...(runningToolCalls && { running: runningToolCalls })}
              {...(onDecide && { onDecide })}
              decisionsDisabled={decisionsDisabled ?? false}
            />
          )}
          {message.role === "assistant" ? (
            <ChatMarkdown text={message.content} />
          ) : (
            <p className="chat-content">{message.content}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
