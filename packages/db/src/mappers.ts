import type {
  LabResultInput,
  MedicationInput,
  Patient,
  PatientSummary,
  RecoveryMilestoneInput,
  SymptomInput,
} from "@health-mcp/shared";

import type {
  LabResultRow,
  MedicationRow,
  PatientRow,
  RecoveryMilestoneRow,
  SymptomRow,
} from "./schema.js";

/** Drops `null` columns so rows match the shared schemas, which use optional fields. */
export function omitNulls<T extends object>(row: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as {
    [K in keyof T]: Exclude<T[K], null>;
  };
}

export const toPatient = (row: PatientRow): Patient => omitNulls(row) as Patient;

export const toPatientSummary = ({
  id,
  mrn,
  firstName,
  lastName,
  status,
  diagnosis,
}: PatientRow): PatientSummary => ({
  id,
  mrn,
  firstName,
  lastName,
  status,
  diagnosis,
});

/** A lab result without its ids, as returned to the model. */
export const toLabResultInput = ({
  id: _id,
  patientId: _patientId,
  ...row
}: LabResultRow): LabResultInput => omitNulls(row) as LabResultInput;

/** A medication without its ids, as returned to the model. */
export const toMedicationInput = ({
  id: _id,
  patientId: _patientId,
  ...row
}: MedicationRow): MedicationInput => omitNulls(row) as MedicationInput;

/** A recovery milestone without its ids, as returned to the model. */
export const toRecoveryMilestoneInput = ({
  id: _id,
  patientId: _patientId,
  ...row
}: RecoveryMilestoneRow): RecoveryMilestoneInput => omitNulls(row) as RecoveryMilestoneInput;

/** A symptom without its ids, as returned to the model. */
export const toSymptomInput = ({
  id: _id,
  patientId: _patientId,
  ...row
}: SymptomRow): SymptomInput => omitNulls(row) as SymptomInput;
