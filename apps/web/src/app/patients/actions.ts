"use server";

import {
  CreatePatientInputSchema,
  PatientImportFileSchema,
  UpdatePatientInputSchema,
} from "@health-mcp/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

import {
  type DeletePatientState,
  type PatientFormState,
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

/** The patient fields of a submitted form, trimmed. */
function readPatientForm(formData: FormData): Partial<Record<PatientField, string>> {
  const values: Partial<Record<PatientField, string>> = {};
  for (const field of PATIENT_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value.trim();
  }
  return values;
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: PatientFormState["fieldErrors"] = {};
  for (const issue of issues) fieldErrors[issue.path[0] as PatientField] ??= issue.message;
  return fieldErrors;
}

export async function createPatientAction(
  _previous: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const values = readPatientForm(formData);
  // Empty optional inputs mean "not provided", not an empty string.
  const input = Object.fromEntries(
    Object.entries(values).filter(
      ([field, value]) => !(OPTIONAL_FIELDS.has(field as PatientField) && value === ""),
    ),
  );

  const parsed = CreatePatientInputSchema.safeParse(input);
  if (!parsed.success) return { values, fieldErrors: fieldErrorsOf(parsed.error.issues) };

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

/** Bind the patient's id: `updatePatientAction.bind(null, id)`. */
export async function updatePatientAction(
  id: string,
  _previous: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const values = readPatientForm(formData);
  // An emptied optional input clears the field.
  const input = Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      OPTIONAL_FIELDS.has(field as PatientField) && value === "" ? null : value,
    ]),
  );
  // Status always has a value in the form; it cannot be cleared.
  if (input.status === null) delete input.status;

  const parsed = UpdatePatientInputSchema.safeParse(input);
  if (!parsed.success) return { values, fieldErrors: fieldErrorsOf(parsed.error.issues) };

  try {
    await api.updatePatient(id, parsed.data);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      return { values, fieldErrors: { mrn: "A patient with this MRN already exists" } };
    }
    if (error instanceof ApiRequestError && error.status === 404) {
      return { values, formError: "This patient no longer exists." };
    }
    return {
      values,
      formError: unavailableMessage(error) ?? "The changes could not be saved. Please try again.",
    };
  }

  revalidatePath("/patients");
  revalidatePath(`/patients/${id}`);
  redirect(`/patients/${id}`);
}

/** Bind the patient's id: `deletePatientAction.bind(null, id)`. */
export async function deletePatientAction(
  id: string,
  _previous: DeletePatientState,
): Promise<DeletePatientState> {
  try {
    await api.deletePatient(id);
  } catch (error) {
    // Already gone: the outcome the user wanted.
    if (!(error instanceof ApiRequestError && error.status === 404)) {
      return {
        formError:
          unavailableMessage(error) ?? "The patient could not be deleted. Please try again.",
      };
    }
  }

  revalidatePath("/patients");
  redirect("/patients");
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
