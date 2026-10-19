import { randomInt } from "node:crypto";
import { createWriteStream } from "node:fs";

import yazl from "yazl";

/*
 * Writes synthetic DICOM files: a made-up "phantom" brain MRI, for tests and
 * for trying the image viewer without real scans. Every file names its
 * patient FAKE^PHANTOM; the importer ignores patient fields anyway.
 */

type Vr = "UI" | "DA" | "CS" | "LO" | "PN" | "IS" | "DS" | "US" | "OB" | "OW" | "UL";

interface Element {
  tag: [number, number];
  vr: Vr;
  value: string | number | Uint8Array;
}

const LONG_LENGTH_VRS = new Set<Vr>(["OB", "OW"]);
export const EXPLICIT_VR_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
const MR_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.4";

/** A random UID under the UUID-derived root `2.25`. */
export const syntheticUid = () => `2.25.${randomInt(1, 2 ** 47)}${randomInt(1, 2 ** 47)}`;

function encodeValue({ vr, value }: Element): Buffer {
  if (vr === "US") {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(value as number);
    return out;
  }
  if (vr === "UL") {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value as number);
    return out;
  }
  if (value instanceof Uint8Array) return Buffer.from(value);
  const text = Buffer.from(String(value), "latin1");
  // Values have even length: UIDs are padded with NUL, other text with a space.
  return text.length % 2 === 0
    ? text
    : Buffer.concat([text, Buffer.from(vr === "UI" ? "\0" : " ")]);
}

function encodeElement(element: Element): Buffer {
  const value = encodeValue(element);
  const long = LONG_LENGTH_VRS.has(element.vr);
  const header = Buffer.alloc(long ? 12 : 8);
  header.writeUInt16LE(element.tag[0], 0);
  header.writeUInt16LE(element.tag[1], 2);
  header.write(element.vr, 4, "latin1");
  if (long) header.writeUInt32LE(value.length, 8);
  else header.writeUInt16LE(value.length, 6);
  return Buffer.concat([header, value]);
}

export interface SyntheticImage {
  studyUid: string;
  seriesUid: string;
  modality?: string;
  studyDate?: string;
  studyDescription?: string;
  seriesDescription?: string;
  bodyPart?: string;
  seriesNumber?: number;
  instanceNumber?: number;
  rows?: number;
  columns?: number;
  /** 16-bit pixel values, rows × columns. */
  pixels?: Uint16Array;
  windowCenter?: number;
  windowWidth?: number;
  /** Writes the transfer syntax of a compressed format, to test unsupported files. */
  transferSyntax?: string;
}

/** One DICOM Part 10 file (explicit VR little endian, 16-bit grayscale). */
export function syntheticDicomFile(image: SyntheticImage): Uint8Array {
  const rows = image.rows ?? 64;
  const columns = image.columns ?? 64;
  const pixels = image.pixels ?? new Uint16Array(rows * columns).map((_, i) => i % 4096);
  const sopInstanceUid = syntheticUid();
  const transferSyntax = image.transferSyntax ?? EXPLICIT_VR_LITTLE_ENDIAN;

  const meta = Buffer.concat(
    [
      { tag: [0x0002, 0x0001], vr: "OB", value: new Uint8Array([0, 1]) },
      { tag: [0x0002, 0x0002], vr: "UI", value: MR_IMAGE_STORAGE },
      { tag: [0x0002, 0x0003], vr: "UI", value: sopInstanceUid },
      { tag: [0x0002, 0x0010], vr: "UI", value: transferSyntax },
      { tag: [0x0002, 0x0012], vr: "UI", value: "2.25.1" },
    ].map((element) => encodeElement(element as Element)),
  );
  const elements: Element[] = [
    { tag: [0x0008, 0x0016], vr: "UI", value: MR_IMAGE_STORAGE },
    { tag: [0x0008, 0x0018], vr: "UI", value: sopInstanceUid },
    {
      tag: [0x0008, 0x0020],
      vr: "DA",
      value: (image.studyDate ?? "2026-10-01").replaceAll("-", ""),
    },
    { tag: [0x0008, 0x0060], vr: "CS", value: image.modality ?? "MR" },
    { tag: [0x0008, 0x1030], vr: "LO", value: image.studyDescription ?? "" },
    { tag: [0x0008, 0x103e], vr: "LO", value: image.seriesDescription ?? "" },
    { tag: [0x0010, 0x0010], vr: "PN", value: "FAKE^PHANTOM" },
    { tag: [0x0010, 0x0020], vr: "LO", value: "FAKE-PHANTOM" },
    { tag: [0x0010, 0x0030], vr: "DA", value: "19000101" },
    { tag: [0x0018, 0x0015], vr: "CS", value: image.bodyPart ?? "" },
    { tag: [0x0020, 0x000d], vr: "UI", value: image.studyUid },
    { tag: [0x0020, 0x000e], vr: "UI", value: image.seriesUid },
    { tag: [0x0020, 0x0011], vr: "IS", value: String(image.seriesNumber ?? 1) },
    { tag: [0x0020, 0x0013], vr: "IS", value: String(image.instanceNumber ?? 1) },
    { tag: [0x0028, 0x0002], vr: "US", value: 1 },
    { tag: [0x0028, 0x0004], vr: "CS", value: "MONOCHROME2" },
    { tag: [0x0028, 0x0010], vr: "US", value: rows },
    { tag: [0x0028, 0x0011], vr: "US", value: columns },
    { tag: [0x0028, 0x0100], vr: "US", value: 16 },
    { tag: [0x0028, 0x0101], vr: "US", value: 12 },
    { tag: [0x0028, 0x0102], vr: "US", value: 11 },
    { tag: [0x0028, 0x0103], vr: "US", value: 0 },
    ...(image.windowCenter !== undefined && image.windowWidth !== undefined
      ? ([
          { tag: [0x0028, 0x1050], vr: "DS", value: String(image.windowCenter) },
          { tag: [0x0028, 0x1051], vr: "DS", value: String(image.windowWidth) },
        ] satisfies Element[])
      : []),
    {
      tag: [0x7fe0, 0x0010],
      vr: "OW",
      value: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    },
  ];

  const groupLength = encodeElement({ tag: [0x0002, 0x0000], vr: "UL", value: meta.length });
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from("DICM", "latin1"),
    groupLength,
    meta,
    ...elements.map(encodeElement),
  ]);
}

/** A slice of the phantom: skull, brain, ventricles and, in the middle slices, a ring lesion. */
export function phantomSlice(size: number, slice: number, slices: number, t2 = false): Uint16Array {
  const pixels = new Uint16Array(size * size);
  const z = (slice + 0.5) / slices - 0.5; // -0.5 … 0.5 through the head
  const scale = Math.sqrt(Math.max(1 - (2 * z) ** 2, 0.05));
  const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  const lesionRadius = Math.max(0.12 * size * (1 - (4 * z) ** 2), 0);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const head = ellipse(x, y, size / 2, size / 2, 0.42 * size * scale, 0.48 * size * scale);
      let value = 0;
      if (head <= 1) value = head > 0.82 ? (t2 ? 400 : 2600) : t2 ? 1400 : 1700;
      if (head <= 0.82) value += Math.round(150 * Math.sin((x + y) / 9)); // gray/white texture
      const ventricle = ellipse(x, y, size / 2, size * 0.47, 0.05 * size, 0.16 * size * scale);
      if (head <= 0.82 && ventricle <= 1) value = t2 ? 3600 : 600;
      if (lesionRadius > 0) {
        const r = Math.hypot(x - size * 0.66, y - size * 0.38);
        if (r <= lesionRadius)
          value = r > lesionRadius * 0.65 ? (t2 ? 2200 : 3800) : t2 ? 3400 : 900;
      }
      pixels[y * size + x] = Math.min(Math.max(value, 0), 4095);
    }
  }
  return pixels;
}

/**
 * Writes a zip like a CD export: a phantom MRI study with two series, plus a
 * non-DICOM file that the importer skips.
 */
export async function writeSyntheticStudyZip(path: string, { slices = 24, size = 192 } = {}) {
  const zip = new yazl.ZipFile();
  const studyUid = syntheticUid();
  const series = [
    { number: 1, description: "Ax T1 post-contrast (synthetic)", t2: false },
    { number: 2, description: "Ax T2 (synthetic)", t2: true },
  ];
  for (const { number, description, t2 } of series) {
    const seriesUid = syntheticUid();
    for (let slice = 0; slice < slices; slice++) {
      const file = syntheticDicomFile({
        studyUid,
        seriesUid,
        studyDate: "2026-10-01",
        studyDescription: "MRI brain with contrast (synthetic phantom)",
        seriesDescription: description,
        bodyPart: "BRAIN",
        seriesNumber: number,
        instanceNumber: slice + 1,
        rows: size,
        columns: size,
        pixels: phantomSlice(size, slice, slices, t2),
      });
      zip.addBuffer(Buffer.from(file), `DICOM/S${number}/IM${String(slice + 1).padStart(4, "0")}`);
    }
  }
  zip.addBuffer(Buffer.from("Synthetic phantom study, not a real patient.\n"), "README.TXT");
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(path)).on("close", resolve).on("error", reject);
  });
}
