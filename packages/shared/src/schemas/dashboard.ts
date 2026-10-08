import { z } from "zod";

import { IdSchema, IsoDateTimeSchema } from "./common.js";
import {
  LabResultSchema,
  MedicationSchema,
  RecoveryMilestoneSchema,
  SymptomSchema,
  VitalSignSchema,
  VitalTypeSchema,
} from "./health-records.js";
import { PatientSchema } from "./patient.js";

/** One row of the all-patients overview. */
export const PatientOverviewRowSchema = z.object({
  patientId: IdSchema,
  name: z.string(),
  mrn: z.string(),
  lastActivityAt: IsoDateTimeSchema.nullable(),
  abnormalLabCount: z.int().nonnegative(),
  activeMedicationCount: z.int().nonnegative(),
  latestPainScore: z.number().nullable(),
  milestonesAchieved: z.int().nonnegative(),
  milestonesTotal: z.int().nonnegative(),
});

/** Response of `GET /dashboards/overview`. */
export const DashboardOverviewSchema = z.object({
  totalPatients: z.int().nonnegative(),
  activePatients: z.int().nonnegative(),
  abnormalLabsLast7Days: z.int().nonnegative(),
  patients: z.array(PatientOverviewRowSchema),
});

export const VitalTrendSchema = z.object({
  type: VitalTypeSchema,
  unit: z.string(),
  points: z.array(z.object({ recordedAt: IsoDateTimeSchema, value: z.number() })),
});

/** Response of `GET /dashboards/patients/:id`. */
export const PatientDashboardSchema = z.object({
  patient: PatientSchema,
  latestVitals: z.array(VitalSignSchema),
  vitalTrends: z.array(VitalTrendSchema),
  recentLabs: z.array(LabResultSchema),
  activeMedications: z.array(MedicationSchema),
  recentSymptoms: z.array(SymptomSchema),
  milestones: z.array(RecoveryMilestoneSchema),
});

export type PatientOverviewRow = z.infer<typeof PatientOverviewRowSchema>;
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
export type VitalTrend = z.infer<typeof VitalTrendSchema>;
export type PatientDashboard = z.infer<typeof PatientDashboardSchema>;
