"use client";

import { useActionState } from "react";

import type { PatientFormState, PatientField } from "./form-state";

interface Props {
  action: (state: PatientFormState, formData: FormData) => Promise<PatientFormState>;
  /** Starting values, e.g. the patient being edited. */
  initialValues?: PatientFormState["values"];
  submitLabel?: string;
}

/** Create or edit a patient. After a failed submit, the form keeps what the user typed. */
export function PatientForm({ action, initialValues, submitLabel = "Create patient" }: Props) {
  const [state, formAction, pending] = useActionState(action, { values: initialValues ?? {} });

  const field = (name: PatientField) => {
    const error = state.fieldErrors?.[name];
    return {
      id: name,
      name,
      defaultValue: state.values?.[name] ?? "",
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${name}-error` : undefined,
    };
  };
  const error = (name: PatientField) =>
    state.fieldErrors?.[name] && (
      <span id={`${name}-error`} className="field-error">
        {state.fieldErrors[name]}
      </span>
    );

  return (
    <form action={formAction} className="form card" noValidate>
      {state.formError && (
        <div className="alert error" role="alert">
          {state.formError}
        </div>
      )}

      <div className="form-row">
        <div className="field">
          <label htmlFor="firstName">First name</label>
          <input {...field("firstName")} required />
          {error("firstName")}
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name</label>
          <input {...field("lastName")} required />
          {error("lastName")}
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="mrn">MRN</label>
          <input {...field("mrn")} required placeholder="FAKE-001" />
          {error("mrn")}
        </div>
        <div className="field">
          <label htmlFor="dateOfBirth">Date of birth</label>
          <input {...field("dateOfBirth")} type="date" required />
          {error("dateOfBirth")}
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="sex">Sex</label>
          <select {...field("sex")} required>
            <option value="">Select…</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="unknown">Unknown</option>
          </select>
          {error("sex")}
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select {...field("status")} defaultValue={state.values?.status || "active"}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {error("status")}
        </div>
      </div>

      <div className="field">
        <label htmlFor="diagnosis">Diagnosis</label>
        <input {...field("diagnosis")} required />
        {error("diagnosis")}
      </div>

      <div className="field">
        <label htmlFor="surgeryDate">Surgery date (optional)</label>
        <input {...field("surgeryDate")} type="date" />
        {error("surgeryDate")}
      </div>

      <div className="field">
        <label htmlFor="notes">Notes (optional)</label>
        <textarea {...field("notes")} rows={3} />
        {error("notes")}
      </div>

      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
