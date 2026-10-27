import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  API_ROUTES,
  type DicomImportResult,
  IdSchema,
  type ImagingStudy,
  type ImagingStudyListResponse,
  type UpdateImagingStudyInput,
  UpdateImagingStudyInputSchema,
} from "@health-mcp/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { IndexingService } from "../rag/indexing.service.js";
import { DicomImportService } from "./dicom-import.service.js";
import { ImagingService } from "./imaging.service.js";

const idParam = { schema: IdSchema };

/** Largest DICOM upload: a CD/DVD export of a few studies fits comfortably. */
export const MAX_DICOM_UPLOAD_BYTES = 2 * 1024 ** 3;
const ZIP_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);

/** Streams the request body to `file`, failing with 413 above the limit. */
async function saveBody(req: Request, file: string): Promise<void> {
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_DICOM_UPLOAD_BYTES)
        callback(new PayloadTooLargeException("The upload is larger than 2 GB"));
      else callback(null, chunk);
    },
  });
  await pipeline(req, limit, createWriteStream(file));
}

/** Routes under `/patients/:id/imaging`. */
@Controller(API_ROUTES.patients)
export class ImagingController {
  constructor(
    private readonly imaging: ImagingService,
    private readonly dicom: DicomImportService,
    private readonly indexing: IndexingService,
  ) {}

  @Get(":id/imaging")
  list(@Param("id", idParam) patientId: string): ImagingStudyListResponse {
    return { studies: this.imaging.list(patientId) };
  }

  /**
   * Uploads a zip of DICOM files (body: the zip itself, `Content-Type:
   * application/zip`). Only technical details and the images are kept.
   */
  @Post(":id/imaging/dicom")
  async uploadDicom(
    @Param("id", idParam) patientId: string,
    @Req() req: Request,
  ): Promise<DicomImportResult> {
    const type = req.headers["content-type"]?.split(";")[0]?.trim() ?? "";
    if (!ZIP_TYPES.has(type))
      throw new UnsupportedMediaTypeException(
        "Send the zip file with Content-Type application/zip",
      );
    if (Number(req.headers["content-length"] ?? 0) > MAX_DICOM_UPLOAD_BYTES)
      throw new PayloadTooLargeException("The upload is larger than 2 GB");

    const dir = await mkdtemp(path.join(tmpdir(), "health-mcp-upload-"));
    try {
      const file = path.join(dir, `${randomUUID()}.zip`);
      await saveBody(req, file);
      return await this.dicom.importZip(patientId, file);
    } finally {
      // The upload may contain identifying details; never keep it.
      await rm(dir, { recursive: true, force: true });
    }
  }

  @Get(":id/imaging/:studyId")
  get(
    @Param("id", idParam) patientId: string,
    @Param("studyId", idParam) studyId: string,
  ): ImagingStudy {
    return this.imaging.get(patientId, studyId);
  }

  @Patch(":id/imaging/:studyId")
  async update(
    @Param("id", idParam) patientId: string,
    @Param("studyId", idParam) studyId: string,
    @Body({ schema: UpdateImagingStudyInputSchema }) input: UpdateImagingStudyInput,
  ): Promise<ImagingStudy> {
    const study = this.imaging.update(patientId, studyId, input);
    await this.indexing.syncPatient(patientId);
    return study;
  }

  @Delete(":id/imaging/:studyId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id", idParam) patientId: string,
    @Param("studyId", idParam) studyId: string,
  ): Promise<void> {
    await this.imaging.remove(patientId, studyId);
    await this.indexing.syncPatient(patientId);
  }

  /** One slice as PNG. Slices never change, so browsers may cache them. */
  @Get(":id/imaging/:studyId/series/:seriesId/images/:position")
  image(
    @Param("id", idParam) patientId: string,
    @Param("studyId", idParam) studyId: string,
    @Param("seriesId", idParam) seriesId: string,
    @Param("position", ParseIntPipe) position: number,
    @Res() res: Response,
  ): void {
    const file = this.imaging.imageFile(patientId, studyId, seriesId, position);
    res.sendFile(file, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }
}
