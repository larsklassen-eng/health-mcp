import { z } from "zod";

import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from "./common.js";

export const SexSchema = z.enum(["female", "male", "other", "unknown"]);
export const PatientStatusSchema = z.enum(["active", "inactive"]);

/** A clinical patient. All data in this project is synthetic or redacted. */
export const PatientSchema = z.object({
  id: IdSchema,
  /** Fake medical record number shown in the UI. */
  mrn: z.string().min(1).max(32),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: IsoDateSchema,
  sex: SexSchema,
  status: PatientStatusSchema,
  diagnosis: z.string().min(1).max(500),
  surgeryDate: IsoDateSchema.optional(),
  notes: z.string().max(5000).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const CreatePatientInputSchema = PatientSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: PatientStatusSchema.default("active"),
});

export const UpdatePatientInputSchema = CreatePatientInputSchema.partial();

/** Compact row for patient lists and pickers. */
export const PatientSummarySchema = PatientSchema.pick({
  id: true,
  mrn: true,
  firstName: true,
  lastName: true,
  status: true,
  diagnosis: true,
});

export const PatientListResponseSchema = z.object({
  patients: z.array(PatientSummarySchema),
});

export type Sex = z.infer<typeof SexSchema>;
export type PatientStatus = z.infer<typeof PatientStatusSchema>;
export type Patient = z.infer<typeof PatientSchema>;
export type CreatePatientInput = z.input<typeof CreatePatientInputSchema>;
export type UpdatePatientInput = z.infer<typeof UpdatePatientInputSchema>;
export type PatientSummary = z.infer<typeof PatientSummarySchema>;
export type PatientListResponse = z.infer<typeof PatientListResponseSchema>;
