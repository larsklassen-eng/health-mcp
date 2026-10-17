"use client";

import { type FormEvent, useActionState } from "react";

import type { DeletePatientState } from "../../form-state";

interface Props {
  action: (state: DeletePatientState) => Promise<DeletePatientState>;
  patientName: string;
}

/** Deletes the patient after the user confirms; the api also deletes all of their records. */
export function DeletePatientButton({ action, patientName }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      `Delete ${patientName}? This also deletes their health records and chat history. ` +
        "It cannot be undone.",
    );
    if (!confirmed) event.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={confirmDelete}>
      {state.formError && (
        <div className="alert error" role="alert">
          {state.formError}
        </div>
      )}
      <button type="submit" className="button danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete patient"}
      </button>
    </form>
  );
}
