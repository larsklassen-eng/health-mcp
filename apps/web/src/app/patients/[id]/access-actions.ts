"use server";

import {
  CreatePatientAccountInputSchema,
  ResetPatientPasswordInputSchema,
} from "@health-mcp/shared";
import { revalidatePath } from "next/cache";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

export interface PatientAccessState {
  error?: string;
  /** Kept after an error, so the form does not lose it. */
  email?: string;
  /** What to give the patient, shown once after creating or resetting (nothing keeps it). */
  issued?: { email: string; password: string };
}

/** The api's own answers, shown as they are: they say what to fix. */
const SHOWN_STATUSES = new Set([400, 409]);

function failure(error: unknown, email?: string): PatientAccessState {
  if (error instanceof ApiRequestError && SHOWN_STATUSES.has(error.status))
    return { error: error.message, ...(email !== undefined && { email }) };
  if (error instanceof ApiRequestError && error.status === 404)
    return { error: "This patient or their account no longer exists. Reload the page." };
  if (!(error instanceof ApiUnavailableError)) console.error("Patient access failed", error);
  return {
    error: "The patient's access could not be changed right now. Try again later.",
    ...(email !== undefined && { email }),
  };
}

/**
 * Creates, resets or removes a patient's own account (form field `intent`).
 * Bind the patient's id: `patientAccessAction.bind(null, id)`. The api checks
 * the email and the password rules again; the form only shows them.
 */
export async function patientAccessAction(
  patientId: string,
  _previous: PatientAccessState,
  form: FormData,
): Promise<PatientAccessState> {
  const intent = form.get("intent");
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  let state: PatientAccessState;

  try {
    if (intent === "create") {
      const parsed = CreatePatientAccountInputSchema.safeParse({ email, password });
      if (!parsed.success) return { email, error: "Check the fields: some are too long." };
      const account = await api.createPatientAccount(patientId, parsed.data);
      state = { issued: { email: account.email, password } };
    } else if (intent === "reset") {
      const parsed = ResetPatientPasswordInputSchema.safeParse({ password });
      if (!parsed.success) return { error: "The password is too long." };
      const account = await api.resetPatientPassword(patientId, parsed.data);
      state = { issued: { email: account.email, password } };
    } else if (intent === "remove") {
      await api.removePatientAccount(patientId);
      state = {};
    } else {
      return { error: "Unknown request." };
    }
  } catch (error) {
    // Removing an account that is already gone is what was wanted.
    if (intent === "remove" && error instanceof ApiRequestError && error.status === 404) state = {};
    else return failure(error, intent === "create" ? email : undefined);
  }

  revalidatePath(`/patients/${patientId}`);
  return state;
}
