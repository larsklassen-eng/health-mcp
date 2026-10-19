import type { LabFlag, VitalType } from "@health-mcp/shared";

/*
 * Display formats for health records. Everything is formatted in UTC so the
 * server and the browser render the same text.
 */

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "Oct 1, 2026" for a date (`2026-10-01`) or a timestamp. */
export const formatDate = (value: string): string => dateFormat.format(new Date(value));

/** "Oct 1, 2026, 10:30 PM UTC". */
export const formatDateTime = (value: string): string =>
  `${dateTimeFormat.format(new Date(value))} UTC`;

export const formatNumber = (value: number): string => numberFormat.format(value);

export const VITAL_LABELS: Record<VitalType, string> = {
  heart_rate: "Heart rate",
  blood_pressure_systolic: "Blood pressure (systolic)",
  blood_pressure_diastolic: "Blood pressure (diastolic)",
  temperature: "Temperature",
  respiratory_rate: "Respiratory rate",
  oxygen_saturation: "Oxygen saturation",
  weight: "Weight",
  pain_score: "Pain score",
};

export const isAbnormalFlag = (flag: LabFlag | undefined): boolean =>
  flag !== undefined && flag !== "normal";

const MODALITY_LABELS: Record<string, string> = {
  MR: "MRI",
  CT: "CT",
  CR: "X-ray",
  DX: "X-ray",
  US: "Ultrasound",
  PT: "PET",
  NM: "Nuclear medicine",
  MG: "Mammography",
  XA: "Angiography",
};

/** "MR" → "MRI"; unknown DICOM modality codes are shown as they are. */
export const modalityLabel = (modality: string): string => MODALITY_LABELS[modality] ?? modality;

/** "3 series, 120 images" (images only when the study has any). */
export function seriesSummary(series: { imageCount: number }[]): string {
  const images = series.reduce((sum, s) => sum + s.imageCount, 0);
  const seriesText = `${series.length} series`;
  return images === 0 ? seriesText : `${seriesText}, ${images} image${images === 1 ? "" : "s"}`;
}
