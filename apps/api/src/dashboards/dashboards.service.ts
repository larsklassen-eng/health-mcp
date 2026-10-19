import {
  labResults,
  medications,
  omitNulls,
  patients,
  recoveryMilestones,
  symptoms,
  toPatient,
  vitalSigns,
} from "@health-mcp/db";
import {
  ABNORMAL_LAB_FLAGS,
  type DashboardOverview,
  type LabResult,
  MAX_RECENT_SYMPTOMS,
  MAX_TREND_POINTS,
  type Medication,
  type PatientDashboard,
  type RecoveryMilestone,
  type Symptom,
  type VitalSign,
  type VitalTrend,
  VitalTypeSchema,
} from "@health-mcp/shared";
import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";

import { DatabaseService } from "../database/database.service.js";
import { ImagingService } from "../imaging/imaging.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const abnormalFlags = sql.join(
  ABNORMAL_LAB_FLAGS.map((flag) => sql`${flag}`),
  sql`, `,
);

@Injectable()
export class DashboardsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly imaging: ImagingService,
  ) {}

  /** `now` sets the end of the 7-day window; tests pass a fixed time. */
  overview(now = new Date()): DashboardOverview {
    const rows = this.database.db
      .select()
      .from(patients)
      .orderBy(asc(patients.lastName), asc(patients.firstName))
      .all();

    const abnormalLabs = this.byPatient<number>(sql`
      select patient_id, count(*) as value from (
        select patient_id, flag, row_number() over (
          partition by patient_id, test_name order by collected_at desc
        ) as position
        from ${labResults}
      )
      where position = 1 and flag in (${abnormalFlags})
      group by patient_id`);
    const activeMedications = this.byPatient<number>(sql`
      select patient_id, count(*) as value from ${medications}
      where status = 'active' group by patient_id`);
    const painScores = this.byPatient<number>(sql`
      select patient_id, value from (
        select patient_id, value, row_number() over (
          partition by patient_id order by recorded_at desc
        ) as position
        from ${vitalSigns} where type = 'pain_score'
      )
      where position = 1`);
    const lastActivity = this.byPatient<string>(sql`
      select patient_id, max(at) as value from (
        select patient_id, collected_at as at from ${labResults}
        union all select patient_id, recorded_at from ${vitalSigns}
        union all select patient_id, recorded_at from ${symptoms}
        union all select patient_id, achieved_at from ${recoveryMilestones}
          where achieved_at is not null
      )
      group by patient_id`);
    const milestonesTotal = this.byPatient<number>(sql`
      select patient_id, count(*) as value from ${recoveryMilestones} group by patient_id`);
    const milestonesAchieved = this.byPatient<number>(sql`
      select patient_id, count(*) as value from ${recoveryMilestones}
      where status = 'achieved' group by patient_id`);

    // Stored times are UTC ISO strings, so the window start is compared as text in the same form.
    const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const recentAbnormal = this.database.db.get<{ count: number }>(sql`
      select count(*) as count from ${labResults}
      where flag in (${abnormalFlags}) and collected_at >= ${since}`);

    return {
      totalPatients: rows.length,
      activePatients: rows.filter((row) => row.status === "active").length,
      abnormalLabsLast7Days: recentAbnormal?.count ?? 0,
      patients: rows.map(({ id, firstName, lastName, mrn, status }) => ({
        patientId: id,
        name: `${firstName} ${lastName}`,
        mrn,
        status,
        lastActivityAt: lastActivity.get(id) ?? null,
        abnormalLabCount: abnormalLabs.get(id) ?? 0,
        activeMedicationCount: activeMedications.get(id) ?? 0,
        latestPainScore: painScores.get(id) ?? null,
        milestonesAchieved: milestonesAchieved.get(id) ?? 0,
        milestonesTotal: milestonesTotal.get(id) ?? 0,
      })),
    };
  }

  patient(id: string): PatientDashboard {
    const { db } = this.database;
    const row = db.select().from(patients).where(eq(patients.id, id)).get();
    if (!row) throw new NotFoundException(`Patient ${id} not found`);

    // One patient has at most a few hundred records, so grouping happens here rather than in SQL.
    const vitals = db
      .select()
      .from(vitalSigns)
      .where(eq(vitalSigns.patientId, id))
      .orderBy(desc(vitalSigns.recordedAt))
      .all();
    const latestVitals: VitalSign[] = [];
    const vitalTrends: VitalTrend[] = [];
    for (const type of VitalTypeSchema.options) {
      const readings = vitals.filter((vital) => vital.type === type);
      const [latest] = readings;
      if (!latest) continue;
      latestVitals.push(latest);
      vitalTrends.push({
        type,
        unit: latest.unit,
        points: readings
          .slice(0, MAX_TREND_POINTS)
          .reverse()
          .map(({ recordedAt, value }) => ({ recordedAt, value })),
      });
    }

    const labs = db
      .select()
      .from(labResults)
      .where(eq(labResults.patientId, id))
      .orderBy(desc(labResults.collectedAt))
      .all();
    const latestLabs = new Map<string, LabResult>();
    for (const lab of labs)
      if (!latestLabs.has(lab.testName)) latestLabs.set(lab.testName, omitNulls(lab) as LabResult);

    return {
      patient: toPatient(row),
      latestVitals,
      vitalTrends,
      recentLabs: [...latestLabs.values()].sort((a, b) => a.testName.localeCompare(b.testName)),
      activeMedications: db
        .select()
        .from(medications)
        .where(and(eq(medications.patientId, id), eq(medications.status, "active")))
        .orderBy(desc(medications.startDate), asc(medications.name))
        .all()
        .map((medication) => omitNulls(medication) as Medication),
      recentSymptoms: db
        .select()
        .from(symptoms)
        .where(eq(symptoms.patientId, id))
        .orderBy(desc(symptoms.recordedAt))
        .limit(MAX_RECENT_SYMPTOMS)
        .all()
        .map((symptom) => omitNulls(symptom) as Symptom),
      milestones: db
        .select()
        .from(recoveryMilestones)
        .where(eq(recoveryMilestones.patientId, id))
        .orderBy(
          asc(sql`${recoveryMilestones.targetDate} is null`),
          asc(recoveryMilestones.targetDate),
          asc(recoveryMilestones.title),
        )
        .all()
        .map((milestone) => omitNulls(milestone) as RecoveryMilestone),
      // Reports can be long; the dashboard shows the impression.
      imagingStudies: this.imaging.list(id).map(({ report: _report, ...study }) => study),
    };
  }

  /** Runs a query returning `patient_id, value` rows and maps value by patient id. */
  private byPatient<T>(query: SQL): Map<string, T> {
    const rows = this.database.db.all<{ patient_id: string; value: T }>(query);
    return new Map(rows.map((row) => [row.patient_id, row.value]));
  }
}
