import { z } from "zod";

import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from "./common.js";

/** Fields every stored record has; omitted from the `*InputSchema` variants. */
const recordKeys = { id: true, patientId: true } as const;

// ---------------------------------------------------------------- lab results

export const LabFlagSchema = z.enum(["low", "normal", "high", "critical"]);

export const LabResultSchema = z.object({
  id: IdSchema,
  patientId: IdSchema,
  testName: z.string().min(1).max(200),
  value: z.number(),
  unit: z.string().max(32),
  referenceLow: z.number().optional(),
  referenceHigh: z.number().optional(),
  flag: LabFlagSchema.optional(),
  collectedAt: IsoDateTimeSchema,
});

export const LabResultInputSchema = LabResultSchema.omit(recordKeys);

// --------------------------------------------------------------------- vitals

export const VitalTypeSchema = z.enum([
  "heart_rate",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "temperature",
  "respiratory_rate",
  "oxygen_saturation",
  "weight",
  "pain_score",
]);

export const VitalSignSchema = z.object({
  id: IdSchema,
  patientId: IdSchema,
  type: VitalTypeSchema,
  value: z.number(),
  unit: z.string().max(32),
  recordedAt: IsoDateTimeSchema,
});

export const VitalSignInputSchema = VitalSignSchema.omit(recordKeys);

// ---------------------------------------------------------------- medications

export const MedicationStatusSchema = z.enum(["active", "stopped"]);

export const MedicationSchema = z.object({
  id: IdSchema,
  patientId: IdSchema,
  name: z.string().min(1).max(200),
  dosage: z.string().min(1).max(100),
  frequency: z.string().min(1).max(100),
  route: z.string().max(50).optional(),
  status: MedicationStatusSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema.optional(),
});

export const MedicationInputSchema = MedicationSchema.omit(recordKeys);

// ------------------------------------------------------------------- symptoms

export const SymptomSchema = z.object({
  id: IdSchema,
  patientId: IdSchema,
  name: z.string().min(1).max(200),
  /** 0 (none) to 10 (worst imaginable). */
  severity: z.int().min(0).max(10),
  notes: z.string().max(2000).optional(),
  recordedAt: IsoDateTimeSchema,
});

export const SymptomInputSchema = SymptomSchema.omit(recordKeys);

// --------------------------------------------------------- recovery milestones

export const MilestoneStatusSchema = z.enum(["pending", "achieved", "missed"]);

export const RecoveryMilestoneSchema = z.object({
  id: IdSchema,
  patientId: IdSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: MilestoneStatusSchema,
  targetDate: IsoDateSchema.optional(),
  achievedAt: IsoDateTimeSchema.optional(),
});

export const RecoveryMilestoneInputSchema = RecoveryMilestoneSchema.omit(recordKeys);

export type LabFlag = z.infer<typeof LabFlagSchema>;
export type LabResult = z.infer<typeof LabResultSchema>;
export type LabResultInput = z.infer<typeof LabResultInputSchema>;
export type VitalType = z.infer<typeof VitalTypeSchema>;
export type VitalSign = z.infer<typeof VitalSignSchema>;
export type VitalSignInput = z.infer<typeof VitalSignInputSchema>;
export type MedicationStatus = z.infer<typeof MedicationStatusSchema>;
export type Medication = z.infer<typeof MedicationSchema>;
export type MedicationInput = z.infer<typeof MedicationInputSchema>;
export type Symptom = z.infer<typeof SymptomSchema>;
export type SymptomInput = z.infer<typeof SymptomInputSchema>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;
export type RecoveryMilestone = z.infer<typeof RecoveryMilestoneSchema>;
export type RecoveryMilestoneInput = z.infer<typeof RecoveryMilestoneInputSchema>;
