"use client";

import { type FormEvent, useActionState } from "react";

import type { DeleteStudyState } from "../actions";

interface Props {
  action: (state: DeleteStudyState) => Promise<DeleteStudyState>;
}

/** Deletes the study and its images after the user confirms. */
export function DeleteStudyButton({ action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("Delete this study with its report and images? It cannot be undone."))
      event.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={confirmDelete}>
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <button type="submit" className="button danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete study"}
      </button>
    </form>
  );
}
