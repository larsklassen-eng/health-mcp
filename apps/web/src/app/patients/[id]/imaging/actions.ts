"use server";

import { IdSchema, UpdateImagingStudyInputSchema } from "@health-mcp/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

export interface StudyReportState {
  values?: { description?: string; impression?: string; report?: string };
  error?: string;
  saved?: boolean;
}

export interface DeleteStudyState {
  error?: string;
}

const failure = (error: unknown, fallback: string): string => {
  if (error instanceof ApiUnavailableError) return `${error.message}. Is it running?`;
  if (error instanceof ApiRequestError && error.body) return error.body.message;
  return fallback;
};

const validIds = (...ids: string[]) => ids.every((id) => IdSchema.safeParse(id).success);

/** Bind the ids: `updateImagingStudyAction.bind(null, patientId, studyId)`. */
export async function updateImagingStudyAction(
  patientId: string,
  studyId: string,
  _previous: StudyReportState,
  formData: FormData,
): Promise<StudyReportState> {
  const values = {
    description: String(formData.get("description") ?? "").trim(),
    impression: String(formData.get("impression") ?? "").trim(),
    report: String(formData.get("report") ?? "").trim(),
  };
  if (!validIds(patientId, studyId)) return { values, error: "Invalid request." };
  // An emptied field clears it.
  const parsed = UpdateImagingStudyInputSchema.safeParse(
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])),
  );
  if (!parsed.success) return { values, error: "The report is too long." };

  try {
    await api.updateImagingStudy(patientId, studyId, parsed.data);
  } catch (error) {
    return { values, error: failure(error, "The report could not be saved. Please try again.") };
  }
  revalidatePath(`/patients/${patientId}/imaging/${studyId}`);
  revalidatePath(`/patients/${patientId}/dashboard`);
  return { values, saved: true };
}

/** Bind the ids: `deleteImagingStudyAction.bind(null, patientId, studyId)`. */
export async function deleteImagingStudyAction(
  patientId: string,
  studyId: string,
  _previous: DeleteStudyState,
): Promise<DeleteStudyState> {
  if (!validIds(patientId, studyId)) return { error: "Invalid request." };
  try {
    await api.deleteImagingStudy(patientId, studyId);
  } catch (error) {
    if (!(error instanceof ApiRequestError && error.status === 404))
      return { error: failure(error, "The study could not be deleted. Please try again.") };
  }
  revalidatePath(`/patients/${patientId}/dashboard`);
  redirect(`/patients/${encodeURIComponent(patientId)}/dashboard`);
}
