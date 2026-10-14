import type { ChatMessage } from "@health-mcp/shared";

const ROLE_LABELS: Record<ChatMessage["role"], string> = { user: "You", assistant: "Assistant" };

/** Formatted in UTC so server and browser render the same text. */
const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export function ChatTranscript({ messages }: { messages: ChatMessage[] }) {
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
        <li key={message.id} className={`chat-message ${message.role}`}>
          <div className="chat-meta">
            <strong>{ROLE_LABELS[message.role]}</strong>{" "}
            <time dateTime={message.createdAt}>{timeFormat.format(new Date(message.createdAt))} UTC</time>
          </div>
          <p className="chat-content">{message.content}</p>
        </li>
      ))}
    </ol>
  );
}
