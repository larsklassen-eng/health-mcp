"use server";

import { CreatePatientInputSchema, PatientImportFileSchema } from "@health-mcp/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

import {
  type CreatePatientState,
  type ImportPatientsState,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ERRORS,
  PATIENT_FIELDS,
  type PatientField,
} from "./form-state";

const OPTIONAL_FIELDS = new Set<PatientField>(["surgeryDate", "notes", "status"]);

function unavailableMessage(error: unknown): string | undefined {
  if (error instanceof ApiUnavailableError) return `${error.message}. Is it running?`;
  return undefined;
}

export async function createPatientAction(
  _previous: CreatePatientState,
  formData: FormData,
): Promise<CreatePatientState> {
  const values: Partial<Record<PatientField, string>> = {};
  for (const field of PATIENT_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value.trim();
  }
  // Empty optional inputs mean "not provided", not an empty string.
  const input = Object.fromEntries(
    Object.entries(values).filter(
      ([field, value]) => !(OPTIONAL_FIELDS.has(field as PatientField) && value === ""),
    ),
  );

  const parsed = CreatePatientInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: CreatePatientState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as PatientField;
      fieldErrors[field] ??= issue.message;
    }
    return { values, fieldErrors };
  }

  let id: string;
  try {
    id = (await api.createPatient(parsed.data)).id;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      return { values, fieldErrors: { mrn: "A patient with this MRN already exists" } };
    }
    return {
      values,
      formError: unavailableMessage(error) ?? "The patient could not be saved. Please try again.",
    };
  }

  revalidatePath("/patients");
  redirect(`/patients/${id}`);
}

export async function importPatientsAction(
  _previous: ImportPatientsState,
  formData: FormData,
): Promise<ImportPatientsState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { formError: "Choose a JSON file to import." };
  if (file.size > MAX_IMPORT_BYTES) return { formError: "The file is larger than 5 MB." };

  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { formError: "The file is not valid JSON." };
  }

  // Check the file here first so problems are listed precisely, before anything is sent.
  const parsed = PatientImportFileSchema.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, MAX_IMPORT_ERRORS)
      .map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`);
    const hidden = parsed.error.issues.length - errors.length;
    if (hidden > 0) errors.push(`…and ${hidden} more`);
    return { errors };
  }

  try {
    const result = await api.importPatients(json);
    revalidatePath("/patients");
    return { result };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      return { formError: `Nothing was imported: ${error.message}` };
    }
    return {
      formError:
        unavailableMessage(error) ?? "The import failed. Nothing was saved. Please try again.",
    };
  }
}
