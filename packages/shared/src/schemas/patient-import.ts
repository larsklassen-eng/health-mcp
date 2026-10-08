import { z } from "zod";

import { IdSchema } from "./common.js";
import {
  LabResultInputSchema,
  MedicationInputSchema,
  RecoveryMilestoneInputSchema,
  SymptomInputSchema,
  VitalSignInputSchema,
} from "./health-records.js";
import { CreatePatientInputSchema } from "./patient.js";

/** One patient and all of their records, as found in an import file. */
export const PatientImportBundleSchema = z.object({
  patient: CreatePatientInputSchema,
  labResults: z.array(LabResultInputSchema).default([]),
  vitals: z.array(VitalSignInputSchema).default([]),
  medications: z.array(MedicationInputSchema).default([]),
  symptoms: z.array(SymptomInputSchema).default([]),
  milestones: z.array(RecoveryMilestoneInputSchema).default([]),
});

/**
 * JSON file accepted by `POST /patients/import`.
 * `version` lets the format change later without breaking old fake-data files.
 */
export const PatientImportFileSchema = z.object({
  version: z.literal(1),
  patients: z.array(PatientImportBundleSchema).min(1),
});

export const PatientImportResultSchema = z.object({
  imported: z.array(
    z.object({
      patientId: IdSchema,
      mrn: z.string(),
      records: z.int().nonnegative(),
    }),
  ),
});

export type PatientImportBundle = z.input<typeof PatientImportBundleSchema>;
export type PatientImportFile = z.input<typeof PatientImportFileSchema>;
export type ParsedPatientImportFile = z.infer<typeof PatientImportFileSchema>;
export type PatientImportResult = z.infer<typeof PatientImportResultSchema>;
