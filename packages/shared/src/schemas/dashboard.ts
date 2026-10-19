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
import { ImagingStudySchema } from "./imaging.js";
import { PatientSchema, PatientStatusSchema } from "./patient.js";

/** Lab flags that count as abnormal on the dashboards. */
export const ABNORMAL_LAB_FLAGS = ["low", "high", "critical"] as const;

/** One row of the all-patients overview. */
export const PatientOverviewRowSchema = z.object({
  patientId: IdSchema,
  /** "First Last". */
  name: z.string(),
  mrn: z.string(),
  status: PatientStatusSchema,
  /** Newest lab, vital, symptom or achieved milestone; `null` without any records. */
  lastActivityAt: IsoDateTimeSchema.nullable(),
  /** Tests whose latest result is flagged low, high or critical. */
  abnormalLabCount: z.int().nonnegative(),
  activeMedicationCount: z.int().nonnegative(),
  /** Latest `pain_score` vital (0–10). */
  latestPainScore: z.number().nullable(),
  milestonesAchieved: z.int().nonnegative(),
  milestonesTotal: z.int().nonnegative(),
});

/** Response of `GET /dashboards/overview`. Patients are sorted by last name, then first name. */
export const DashboardOverviewSchema = z.object({
  totalPatients: z.int().nonnegative(),
  activePatients: z.int().nonnegative(),
  /** Abnormal lab results collected in the 7 days before the request, across all patients. */
  abnormalLabsLast7Days: z.int().nonnegative(),
  patients: z.array(PatientOverviewRowSchema),
});

/** Readings per vital type in `PatientDashboard.vitalTrends`. */
export const MAX_TREND_POINTS = 60;
/** Symptoms in `PatientDashboard.recentSymptoms`. */
export const MAX_RECENT_SYMPTOMS = 10;

export const VitalTrendSchema = z.object({
  type: VitalTypeSchema,
  unit: z.string(),
  /** The latest readings (at most `MAX_TREND_POINTS`), oldest first. */
  points: z.array(z.object({ recordedAt: IsoDateTimeSchema, value: z.number() })),
});

/**
 * Response of `GET /dashboards/patients/:id`. Vitals and trends follow the
 * order of `VitalTypeSchema` and leave out types without readings.
 */
export const PatientDashboardSchema = z.object({
  patient: PatientSchema,
  /** The latest reading of each vital type. */
  latestVitals: z.array(VitalSignSchema),
  vitalTrends: z.array(VitalTrendSchema),
  /** The latest result of each test, by test name. */
  recentLabs: z.array(LabResultSchema),
  /** Most recently started first. */
  activeMedications: z.array(MedicationSchema),
  /** The latest symptoms (at most `MAX_RECENT_SYMPTOMS`), newest first. */
  recentSymptoms: z.array(SymptomSchema),
  /** By target date, earliest first; milestones without one come last. */
  milestones: z.array(RecoveryMilestoneSchema),
  /** Newest first, without the full report text. */
  imagingStudies: z.array(ImagingStudySchema.omit({ report: true })),
});

export type PatientOverviewRow = z.infer<typeof PatientOverviewRowSchema>;
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
export type VitalTrend = z.infer<typeof VitalTrendSchema>;
export type PatientDashboard = z.infer<typeof PatientDashboardSchema>;
