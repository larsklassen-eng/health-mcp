"use client";

import type { RecordChange } from "@health-mcp/shared";
import { useState } from "react";

import { RecordChanges } from "./record-changes";

export type ToolCallDecision = "confirm" | "reject";
/** Resolves to an error message, or `undefined` when the decision was saved. */
export type DecideToolCall = (
  toolCallId: string,
  decision: ToolCallDecision,
) => Promise<string | undefined>;

interface Props {
  toolCallId: string;
  /** What will be saved, in plain words; shown when there is no preview. */
  summary: string;
  /** What will change, each field's old and new value (from a dry run). */
  preview?: RecordChange[];
  onDecide: DecideToolCall;
  /** E.g. while the answer is still streaming and the entry is not saved in the chat yet. */
  disabled?: boolean;
}

/** Save or discard an entry the assistant proposed. Nothing is saved until "Save". */
export function ToolCallConfirmation({
  toolCallId,
  summary,
  preview,
  onDecide,
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState<ToolCallDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: ToolCallDecision) {
    setBusy(decision);
    setError(null);
    const failure = await onDecide(toolCallId, decision);
    setBusy(null);
    if (failure) setError(failure);
  }

  return (
    <div className="tool-call-confirmation" role="group" aria-label="Confirm entry">
      {preview ? (
        <>
          <p>
            <strong>Save to the patient&apos;s record?</strong>
          </p>
          <RecordChanges changes={preview} label="Changes to save" />
        </>
      ) : (
        <p>
          <strong>Save to the patient&apos;s record?</strong> {summary}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={disabled || busy !== null}
          onClick={() => void decide("confirm")}
        >
          {busy === "confirm" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy !== null}
          onClick={() => void decide("reject")}
        >
          {busy === "reject" ? "Discarding…" : "Discard"}
        </button>
      </div>
    </div>
  );
}
