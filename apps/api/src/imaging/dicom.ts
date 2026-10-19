import { createHash } from "node:crypto";

import dicomParser from "dicom-parser";
import { PNG } from "pngjs";

/*
 * Reads DICOM files from an upload. Only the technical and clinical fields
 * below and the pixel data are read; identifying fields (name, birth date,
 * patient ID, institution, physicians, accession number) are never read, and
 * the study's UID is only kept as a hash.
 */

const TAG = {
  transferSyntax: "x00020010",
  studyUid: "x0020000d",
  seriesUid: "x0020000e",
  modality: "x00080060",
  studyDate: "x00080020",
  seriesDate: "x00080021",
  studyDescription: "x00081030",
  seriesDescription: "x0008103e",
  bodyPart: "x00180015",
  seriesNumber: "x00200011",
  instanceNumber: "x00200013",
  sliceLocation: "x00201041",
  samplesPerPixel: "x00280002",
  photometric: "x00280004",
  planarConfiguration: "x00280006",
  numberOfFrames: "x00280008",
  rows: "x00280010",
  columns: "x00280011",
  bitsAllocated: "x00280100",
  bitsStored: "x00280101",
  pixelRepresentation: "x00280103",
  windowCenter: "x00281050",
  windowWidth: "x00281051",
  rescaleIntercept: "x00281052",
  rescaleSlope: "x00281053",
  pixelData: "x7fe00010",
} as const;

/** Uncompressed little-endian pixel data: the only transfer syntaxes the viewer decodes. */
const SUPPORTED_TRANSFER_SYNTAXES = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"]);

/** What an image belongs to; enough to group files into studies and series. */
export interface DicomImageInfo {
  /** SHA-256 of the StudyInstanceUID. */
  studyHash: string;
  /** SHA-256 of the SeriesInstanceUID. */
  seriesHash: string;
  modality: string;
  /** `YYYY-MM-DD`, from the study date (or the series date). */
  studyDate?: string;
  studyDescription?: string;
  seriesDescription?: string;
  bodyPart?: string;
  seriesNumber?: number;
  instanceNumber?: number;
  sliceLocation?: number;
}

export type DicomReadResult =
  /** Not a DICOM file, or one that cannot be parsed. */
  | { kind: "not-dicom" }
  /** DICOM without an image, e.g. the DICOMDIR index of a CD or a structured report. */
  | { kind: "no-image" }
  /** An image in a pixel format the viewer cannot decode (e.g. compressed). */
  | { kind: "unsupported"; info: DicomImageInfo; frames: number }
  /** One PNG per frame (most CT and MR files have one). */
  | { kind: "image"; info: DicomImageInfo; frames: Buffer[] };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Trims a text field and collapses inner whitespace; `undefined` when empty. */
function text(dataSet: dicomParser.DataSet, tag: string, max: number): string | undefined {
  const value = dataSet.string(tag)?.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, max) : undefined;
}

function number(dataSet: dicomParser.DataSet, tag: string): number | undefined {
  const value = dataSet.floatString(tag);
  return value === undefined || Number.isNaN(value) ? undefined : value;
}

/** DICOM dates are `YYYYMMDD`. */
function isoDate(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(Date.parse(date)) ? undefined : date;
}

/** "BRAIN" → "Brain". */
const titleCase = (value: string | undefined) =>
  value && value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

function readInfo(dataSet: dicomParser.DataSet, studyUid: string, seriesUid: string) {
  const info: DicomImageInfo = {
    studyHash: sha256(studyUid),
    seriesHash: sha256(seriesUid),
    modality:
      text(dataSet, TAG.modality, 16)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]/g, "") || "OT",
  };
  const optional = {
    studyDate: isoDate(dataSet.string(TAG.studyDate)) ?? isoDate(dataSet.string(TAG.seriesDate)),
    studyDescription: text(dataSet, TAG.studyDescription, 500),
    seriesDescription: text(dataSet, TAG.seriesDescription, 500),
    bodyPart: titleCase(text(dataSet, TAG.bodyPart, 100)),
    seriesNumber: dataSet.intString(TAG.seriesNumber),
    instanceNumber: dataSet.intString(TAG.instanceNumber),
    sliceLocation: number(dataSet, TAG.sliceLocation),
  };
  for (const [key, value] of Object.entries(optional))
    if (value !== undefined && !Number.isNaN(value)) Object.assign(info, { [key]: value });
  return info;
}

interface PixelFormat {
  rows: number;
  columns: number;
  samples: number;
  bitsAllocated: number;
  bitsStored: number;
  signed: boolean;
  planar: boolean;
  monochrome1: boolean;
  slope: number;
  intercept: number;
  window: { center: number; width: number } | undefined;
}

function pixelFormat(dataSet: dicomParser.DataSet): PixelFormat | undefined {
  const rows = dataSet.uint16(TAG.rows) ?? 0;
  const columns = dataSet.uint16(TAG.columns) ?? 0;
  const samples = dataSet.uint16(TAG.samplesPerPixel) ?? 1;
  const bitsAllocated = dataSet.uint16(TAG.bitsAllocated) ?? 0;
  const photometric = dataSet.string(TAG.photometric) ?? "MONOCHROME2";
  const grayscale = samples === 1 && (bitsAllocated === 8 || bitsAllocated === 16);
  const color = samples === 3 && bitsAllocated === 8 && photometric === "RGB";
  if (rows === 0 || columns === 0 || !(grayscale || color)) return undefined;

  const center = number(dataSet, TAG.windowCenter);
  const width = number(dataSet, TAG.windowWidth);
  return {
    rows,
    columns,
    samples,
    bitsAllocated,
    bitsStored: Math.min(dataSet.uint16(TAG.bitsStored) ?? bitsAllocated, bitsAllocated),
    signed: dataSet.uint16(TAG.pixelRepresentation) === 1,
    planar: dataSet.uint16(TAG.planarConfiguration) === 1,
    monochrome1: photometric === "MONOCHROME1",
    slope: number(dataSet, TAG.rescaleSlope) ?? 1,
    intercept: number(dataSet, TAG.rescaleIntercept) ?? 0,
    window:
      center !== undefined && width !== undefined && width > 1 ? { center, width } : undefined,
  };
}

/** Grayscale frame → 8-bit PNG, using the file's window or, without one, the frame's range. */
function grayscalePng(bytes: Uint8Array, offset: number, format: PixelFormat): Buffer {
  const count = format.rows * format.columns;
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    count * (format.bitsAllocated / 8),
  );
  const mask = 2 ** format.bitsStored - 1;
  const signBit = 2 ** (format.bitsStored - 1);
  const values = new Float64Array(count);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    let raw = format.bitsAllocated === 16 ? view.getUint16(i * 2, true) : view.getUint8(i);
    raw &= mask; // high bits may hold overlays
    if (format.signed && raw >= signBit) raw -= signBit * 2;
    const value = raw * format.slope + format.intercept;
    values[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // Linear window as defined by DICOM (PS3.3 C.11.2.1.2).
  const { center, width } = format.window ?? { center: (min + max) / 2, width: max - min + 1 };
  const low = center - 0.5 - (width - 1) / 2;
  const range = Math.max(width - 1, 1);
  const png = new PNG({ width: format.columns, height: format.rows, colorType: 0, bitDepth: 8 });
  const gray = Buffer.alloc(count);
  for (let i = 0; i < count; i++) {
    const level = Math.round(Math.min(Math.max((values[i]! - low) / range, 0), 1) * 255);
    gray[i] = format.monochrome1 ? 255 - level : level;
  }
  png.data = gray;
  return PNG.sync.write(png, { colorType: 0, inputColorType: 0 });
}

function rgbPng(bytes: Uint8Array, offset: number, format: PixelFormat): Buffer {
  const count = format.rows * format.columns;
  const png = new PNG({ width: format.columns, height: format.rows, colorType: 2, bitDepth: 8 });
  const rgb = Buffer.alloc(count * 3);
  for (let i = 0; i < count; i++)
    for (let c = 0; c < 3; c++)
      rgb[i * 3 + c] = bytes[offset + (format.planar ? c * count + i : i * 3 + c)]!;
  png.data = rgb;
  return PNG.sync.write(png, { colorType: 2, inputColorType: 2 });
}

/** Reads one file of an upload. Never throws: unreadable files are `not-dicom`. */
export function readDicomFile(bytes: Uint8Array): DicomReadResult {
  // Part 10 files start with a 128-byte preamble and "DICM".
  if (bytes.length < 132 || Buffer.from(bytes.subarray(128, 132)).toString("latin1") !== "DICM")
    return { kind: "not-dicom" };

  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(bytes);
  } catch {
    return { kind: "not-dicom" };
  }

  const studyUid = dataSet.string(TAG.studyUid);
  const seriesUid = dataSet.string(TAG.seriesUid);
  const pixels = dataSet.elements[TAG.pixelData];
  if (!studyUid || !seriesUid || !pixels) return { kind: "no-image" };

  const info = readInfo(dataSet, studyUid, seriesUid);
  const frames = Math.max(dataSet.intString(TAG.numberOfFrames) ?? 1, 1);
  const format = pixelFormat(dataSet);
  const transferSyntax = dataSet.string(TAG.transferSyntax) ?? "1.2.840.10008.1.2";
  const frameBytes =
    format && format.rows * format.columns * format.samples * (format.bitsAllocated / 8);
  if (
    !format ||
    !frameBytes ||
    !SUPPORTED_TRANSFER_SYNTAXES.has(transferSyntax) ||
    pixels.encapsulatedPixelData ||
    pixels.length < frameBytes * frames
  )
    return { kind: "unsupported", info, frames };

  const pngs: Buffer[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const offset = pixels.dataOffset + frame * frameBytes;
    pngs.push(
      format.samples === 3 ? rgbPng(bytes, offset, format) : grayscalePng(bytes, offset, format),
    );
  }
  return { kind: "image", info, frames: pngs };
}
