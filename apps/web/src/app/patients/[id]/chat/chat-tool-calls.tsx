import type { McpToolName, ToolCall } from "@health-mcp/shared";

import { type DecideToolCall, ToolCallConfirmation } from "./tool-call-confirmation";

const TOOL_LABELS: Record<McpToolName, string> = {
  get_patient_profile: "Patient profile",
  get_lab_results: "Lab results",
  get_vitals_trend: "Vitals trend",
  get_medications: "Medications",
  log_symptom: "Log symptom",
  get_recovery_milestones: "Recovery milestones",
};

/** Results can be large (up to 100 lab results); the card shows the start. */
export const MAX_OUTPUT_CHARS = 4000;

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;

const toolLabel = (name: string) =>
  Object.hasOwn(TOOL_LABELS, name) ? TOOL_LABELS[name as McpToolName] : name;

function formatValue(value: unknown): string {
  if (typeof value === "string")
    return ISO_DATE.test(value) ? dateFormat.format(new Date(value)) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  return JSON.stringify(value);
}

/** The arguments in plain words, e.g. "test name: Hemoglobin · since: Sep 1, 2026". */
export function formatToolInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${formatValue(value)}`)
    .join(" · ");
}

function formatOutput(output: unknown): string {
  const text = typeof output === "string" ? output : (JSON.stringify(output, null, 2) ?? "");
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (shortened)`
    : text;
}

type Status = "running" | "failed" | "done" | "pending" | "confirmed" | "rejected";

const STATUS_LABELS: Record<Status, string> = {
  running: "Running…",
  failed: "Failed",
  done: "Done",
  pending: "Needs your confirmation",
  confirmed: "Saved",
  rejected: "Discarded",
};

function statusOf(call: ToolCall, running: ReadonlySet<string> | undefined): Status {
  if (running?.has(call.id)) return "running";
  if (call.isError) return "failed";
  return call.confirmation ?? "done";
}

interface Props {
  calls: ToolCall[];
  /** Calls still waiting for their result. */
  running?: ReadonlySet<string>;
  /** Saves or discards a pending entry; without it, pending entries show no buttons. */
  onDecide?: DecideToolCall;
  /** Disables the Save and Discard buttons, e.g. while the answer streams. */
  decisionsDisabled?: boolean;
}

/** What the assistant did for an answer: one collapsible card per tool call. */
export function ChatToolCalls({ calls, running, onDecide, decisionsDisabled }: Props) {
  if (calls.length === 0) return null;

  return (
    <ul className="tool-calls" aria-label="Data the assistant used">
      {calls.map((call) => {
        const status = statusOf(call, running);
        const input = formatToolInput(call.input);
        return (
          <li key={call.id} className={`tool-call ${status}`}>
            <details>
              <summary>
                <span className="tool-call-name">{toolLabel(call.name)}</span>
                {input && <span className="tool-call-input">{input}</span>}
                <span className="tool-call-status">{STATUS_LABELS[status]}</span>
              </summary>
              {status === "running" ? (
                <p className="muted tool-call-output">Waiting for the result…</p>
              ) : status === "pending" || status === "rejected" ? (
                <p className="muted tool-call-output">Nothing was saved.</p>
              ) : (
                <pre className="tool-call-output">{formatOutput(call.output)}</pre>
              )}
            </details>
            {status === "pending" && onDecide && (
              <ToolCallConfirmation
                toolCallId={call.id}
                summary={input}
                onDecide={onDecide}
                disabled={decisionsDisabled ?? false}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
