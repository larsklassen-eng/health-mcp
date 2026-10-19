"use client";

import { useActionState } from "react";

import type { StudyReportState } from "../actions";

interface Props {
  action: (state: StudyReportState, formData: FormData) => Promise<StudyReportState>;
  initial: { description?: string; impression?: string; report?: string };
}

/** Edits the study's description and its radiology report. Empty fields are cleared. */
export function StudyReportForm({ action, initial }: Props) {
  const [state, formAction, pending] = useActionState(action, { values: initial });
  const value = (name: keyof NonNullable<StudyReportState["values"]>) => state.values?.[name] ?? "";

  return (
    <form action={formAction} className="form card study-report-form">
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {state.saved && !pending && (
        <p className="muted" role="status">
          Saved.
        </p>
      )}
      <div className="field">
        <label htmlFor="description">Description</label>
        <input id="description" name="description" defaultValue={value("description")} />
      </div>
      <div className="field">
        <label htmlFor="impression">Impression</label>
        <textarea id="impression" name="impression" rows={2} defaultValue={value("impression")} />
      </div>
      <div className="field">
        <label htmlFor="report">Report</label>
        <textarea id="report" name="report" rows={10} defaultValue={value("report")} />
      </div>
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Saving…" : "Save report"}
        </button>
      </div>
    </form>
  );
}
