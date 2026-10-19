"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { ImportPatientsState } from "./form-state";

interface Props {
  action: (state: ImportPatientsState, formData: FormData) => Promise<ImportPatientsState>;
}

export function ImportPatientsForm({ action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <div className="form">
      <form action={formAction} className="form card">
        <div className="field">
          <label htmlFor="file">JSON file (up to 5 MB)</label>
          <input id="file" name="file" type="file" accept="application/json,.json" required />
        </div>
        <div>
          <button type="submit" className="button" disabled={pending}>
            {pending ? "Importing…" : "Import"}
          </button>
        </div>
      </form>

      {state.formError && (
        <div className="alert error" role="alert">
          {state.formError}
        </div>
      )}

      {state.errors && (
        <div className="alert error" role="alert">
          <strong>The file has problems. Nothing was imported.</strong>
          <ul>
            {state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {state.result && (
        <div className="alert success" role="status">
          <strong>
            Imported {state.result.imported.length}{" "}
            {state.result.imported.length === 1 ? "patient" : "patients"}.
          </strong>
          <ul>
            {state.result.imported.map(({ patientId, mrn, records }) => (
              <li key={patientId}>
                <Link href={`/patients/${encodeURIComponent(patientId)}`}>{mrn}</Link> (
                {records === 1 ? "1 record" : `${records} records`})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
