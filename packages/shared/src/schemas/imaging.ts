import { z } from "zod";

import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from "./common.js";

/** DICOM modality code, e.g. `MR`, `CT`, `CR` (X-ray), `US`. */
export const ModalitySchema = z.string().regex(/^[A-Z0-9]{1,16}$/);

/** How a study got into the app: the JSON import (no images) or a DICOM upload. */
export const ImagingSourceSchema = z.enum(["import", "dicom"]);

/** One series of a study, e.g. "T1 axial post-contrast". Its images are PNG slices. */
export const ImagingSeriesSchema = z.object({
  id: IdSchema,
  studyId: IdSchema,
  seriesNumber: z.int().optional(),
  description: z.string().max(500).optional(),
  modality: ModalitySchema,
  /** Viewable slices, numbered from 0 in display order. */
  imageCount: z.int().nonnegative(),
});

/**
 * An imaging study (e.g. a brain MRI) with its radiology report. Only clinical
 * and technical details are kept: nothing that identifies the patient is
 * read from DICOM files.
 */
export const ImagingStudySchema = z.object({
  id: IdSchema,
  patientId: IdSchema,
  modality: ModalitySchema,
  bodyPart: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  studyDate: IsoDateSchema,
  /** Short conclusion of the report. */
  impression: z.string().min(1).max(2000).optional(),
  /** Full report text (findings and impression). */
  report: z.string().min(1).max(20_000).optional(),
  source: ImagingSourceSchema,
  series: z.array(ImagingSeriesSchema),
  createdAt: IsoDateTimeSchema,
});

/** A study in the JSON import file: details and report, no images. */
export const ImagingStudyInputSchema = ImagingStudySchema.pick({
  modality: true,
  bodyPart: true,
  description: true,
  studyDate: true,
  impression: true,
  report: true,
});

/** Body of `PATCH /patients/:id/imaging/:studyId`. `null` clears a field. */
export const UpdateImagingStudyInputSchema = z.object({
  description: ImagingStudySchema.shape.description.unwrap().nullable().optional(),
  impression: ImagingStudySchema.shape.impression.unwrap().nullable().optional(),
  report: ImagingStudySchema.shape.report.unwrap().nullable().optional(),
});

/** Response of `GET /patients/:id/imaging`: newest first. */
export const ImagingStudyListResponseSchema = z.object({
  studies: z.array(ImagingStudySchema),
});

/** Response of `POST /patients/:id/imaging/dicom`. */
export const DicomImportResultSchema = z.object({
  studies: z.array(
    z.object({
      studyId: IdSchema,
      modality: ModalitySchema,
      description: z.string().optional(),
      studyDate: IsoDateSchema,
      series: z.int().nonnegative(),
      images: z.int().nonnegative(),
      /** The same study was uploaded before for this patient; nothing new was saved. */
      alreadyImported: z.boolean(),
    }),
  ),
  /** Files in the upload that are not DICOM, e.g. the viewer program on a CD. */
  skippedFiles: z.int().nonnegative(),
  /** DICOM images whose pixel format is not supported (e.g. compressed); they are not shown. */
  unsupportedImages: z.int().nonnegative(),
});

export type ImagingSource = z.infer<typeof ImagingSourceSchema>;
export type ImagingSeries = z.infer<typeof ImagingSeriesSchema>;
export type ImagingStudy = z.infer<typeof ImagingStudySchema>;
export type ImagingStudyInput = z.infer<typeof ImagingStudyInputSchema>;
export type UpdateImagingStudyInput = z.infer<typeof UpdateImagingStudyInputSchema>;
export type ImagingStudyListResponse = z.infer<typeof ImagingStudyListResponseSchema>;
export type DicomImportResult = z.infer<typeof DicomImportResultSchema>;
