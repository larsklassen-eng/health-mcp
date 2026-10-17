import type { PatientImportResult } from "@health-mcp/shared";

export const PATIENT_FIELDS = [
  "mrn",
  "firstName",
  "lastName",
  "dateOfBirth",
  "sex",
  "status",
  "diagnosis",
  "surgeryDate",
  "notes",
] as const;

export type PatientField = (typeof PATIENT_FIELDS)[number];

export interface PatientFormState {
  /** What the user typed, so the form keeps it after a failed submit. */
  values?: Partial<Record<PatientField, string>>;
  fieldErrors?: Partial<Record<PatientField, string>>;
  formError?: string;
}

export interface DeletePatientState {
  formError?: string;
}

export interface ImportPatientsState {
  /** Schema problems in the file, as `path: message`. */
  errors?: string[];
  formError?: string;
  result?: PatientImportResult;
}

/** Same limit as apps/api. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** Only the first problems are shown; a broken file can have thousands. */
export const MAX_IMPORT_ERRORS = 20;
