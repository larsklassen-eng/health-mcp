import { type HealthDb, vitalSigns } from "@health-mcp/db";
import type { VitalType } from "@health-mcp/shared";
import { and, asc, desc, eq, gte } from "drizzle-orm";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

/** Above this many readings, the tool returns one entry per day instead of every reading. */
export const MAX_RAW_POINTS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

const round = (value: number) => Math.round(value * 100) / 100;

export interface VitalReading {
  recordedAt: string;
  value: number;
}

/** One UTC day of readings, used when there are too many to list. */
export interface DailyVitals {
  date: string;
  count: number;
  min: number;
  max: number;
  average: number;
}

export interface VitalsTrendOutput {
  vitalType: VitalType;
  /** Unit of the most recent reading in the window. */
  unit: string | null;
  /** Start of the window (UTC). */
  since: string;
  /** Every reading, oldest first; omitted when `daily` is used. */
  readings?: VitalReading[];
  /** One entry per UTC day, oldest first; used instead of `readings` above {@link MAX_RAW_POINTS} readings. */
  daily?: DailyVitals[];
  summary: {
    count: number;
    min: number;
    max: number;
    average: number;
    first: VitalReading;
    latest: VitalReading;
    /** `latest.value - first.value`. */
    change: number;
  } | null;
  /** Only when the window is empty: when this vital was last recorded, if ever. */
  lastRecordedAt?: string | null;
}

function dailyBuckets(readings: VitalReading[]): DailyVitals[] {
  const days = new Map<string, number[]>();
  for (const { recordedAt, value } of readings) {
    const day = recordedAt.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), value]);
  }
  return [...days].map(([date, values]) => ({
    date,
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    average: round(values.reduce((sum, v) => sum + v, 0) / values.length),
  }));
}

export const getVitalsTrend =
  (db: HealthDb, now: () => Date = () => new Date()): ToolHandler<"get_vitals_trend"> =>
  ({ patient_id, vital_type, days }): VitalsTrendOutput => {
    requirePatient(db, patient_id);
    const since = new Date(now().getTime() - days * DAY_MS).toISOString();
    const forVital = and(eq(vitalSigns.patientId, patient_id), eq(vitalSigns.type, vital_type));

    const rows = db
      .select({ recordedAt: vitalSigns.recordedAt, value: vitalSigns.value, unit: vitalSigns.unit })
      .from(vitalSigns)
      .where(and(forVital, gte(vitalSigns.recordedAt, since)))
      .orderBy(asc(vitalSigns.recordedAt))
      .all();

    if (rows.length === 0) {
      const last = db.select({ recordedAt: vitalSigns.recordedAt }).from(vitalSigns).where(forVital).orderBy(desc(vitalSigns.recordedAt)).limit(1).get();
      return { vitalType: vital_type, unit: null, since, readings: [], summary: null, lastRecordedAt: last?.recordedAt ?? null };
    }

    const readings = rows.map(({ recordedAt, value }) => ({ recordedAt, value }));
    const values = readings.map((r) => r.value);
    const first = readings[0]!;
    const latest = readings.at(-1)!;
    return {
      vitalType: vital_type,
      unit: rows.at(-1)!.unit,
      since,
      ...(readings.length > MAX_RAW_POINTS ? { daily: dailyBuckets(readings) } : { readings }),
      summary: {
        count: readings.length,
        min: Math.min(...values),
        max: Math.max(...values),
        average: round(values.reduce((sum, v) => sum + v, 0) / values.length),
        first,
        latest,
        change: round(latest.value - first.value),
      },
    };
  };
