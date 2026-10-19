import { type HealthDb, imagingSeries, imagingStudies, omitNulls } from "@health-mcp/db";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";

import { requirePatient } from "./patients.js";
import type { ToolHandler } from "./tool.js";

/** Longest report text returned per study; reports can be long and several fit in one answer. */
export const MAX_REPORT_CHARS = 4000;

export interface ImagingStudyOutput {
  studyDate: string;
  modality: string;
  bodyPart?: string;
  description?: string;
  impression?: string;
  report?: string;
  /** Set when `report` was cut to {@link MAX_REPORT_CHARS}. */
  reportTruncated?: true;
  /** Series in the study, e.g. "Ax T1 post"; empty for studies imported without images. */
  series: { description?: string; imageCount: number }[];
}

export interface ImagingStudiesOutput {
  /** Newest first. */
  studies: ImagingStudyOutput[];
  /** True when more studies match than `limit` allowed. */
  hasMore: boolean;
}

export const getImagingStudies =
  (db: HealthDb): ToolHandler<"get_imaging_studies"> =>
  ({ patient_id, modality, limit }): ImagingStudiesOutput => {
    requirePatient(db, patient_id);

    const conditions: SQL[] = [eq(imagingStudies.patientId, patient_id)];
    if (modality !== undefined) conditions.push(eq(imagingStudies.modality, modality));
    const rows = db
      .select()
      .from(imagingStudies)
      .where(and(...conditions))
      .orderBy(desc(imagingStudies.studyDate), desc(imagingStudies.createdAt))
      .limit(limit + 1)
      .all();
    const shown = rows.slice(0, limit);

    const series = db
      .select()
      .from(imagingSeries)
      .where(
        inArray(
          imagingSeries.studyId,
          shown.map((row) => row.id),
        ),
      )
      .orderBy(asc(imagingSeries.seriesNumber))
      .all();

    return {
      studies: shown.map((row) => {
        const { studyDate, modality, bodyPart, description, impression, report } = omitNulls(row);
        const truncated = report !== undefined && report.length > MAX_REPORT_CHARS;
        return {
          studyDate,
          modality,
          ...(bodyPart !== undefined && { bodyPart }),
          ...(description !== undefined && { description }),
          ...(impression !== undefined && { impression }),
          ...(report !== undefined && { report: report.slice(0, MAX_REPORT_CHARS) }),
          ...(truncated && { reportTruncated: true as const }),
          series: series
            .filter((s) => s.studyId === row.id)
            .map(({ description: seriesDescription, imageCount }) => ({
              ...(seriesDescription !== null && { description: seriesDescription }),
              imageCount,
            })),
        };
      }),
      hasMore: rows.length > limit,
    };
  };
