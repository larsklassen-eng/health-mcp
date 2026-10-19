import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { readDicomFile } from "../src/imaging/dicom.js";
import { syntheticDicomFile, syntheticUid } from "../src/imaging/synthetic-dicom.js";

const uids = () => ({ studyUid: syntheticUid(), seriesUid: syntheticUid() });
const gray = (png: Buffer) => [...PNG.sync.read(png).data.filter((_, i) => i % 4 === 0)];

describe("readDicomFile", () => {
  it("reads study details and turns the image into a PNG of the same size", () => {
    const result = readDicomFile(
      syntheticDicomFile({
        ...uids(),
        modality: "CT",
        studyDate: "2026-08-06",
        studyDescription: "  CT head   without contrast ",
        seriesDescription: "Axial 5 mm",
        bodyPart: "HEAD",
        seriesNumber: 3,
        instanceNumber: 12,
        rows: 4,
        columns: 6,
      }),
    );

    expect(result.kind).toBe("image");
    if (result.kind !== "image") return;
    expect(result.info).toMatchObject({
      modality: "CT",
      studyDate: "2026-08-06",
      studyDescription: "CT head without contrast",
      seriesDescription: "Axial 5 mm",
      bodyPart: "Head",
      seriesNumber: 3,
      instanceNumber: 12,
    });
    expect(result.info.studyHash).toMatch(/^[0-9a-f]{64}$/);
    const png = PNG.sync.read(result.frames[0]!);
    expect([png.width, png.height]).toEqual([6, 4]);
  });

  it("applies the file's window, and without one stretches the image's own range", () => {
    const pixels = new Uint16Array([0, 1000, 2000, 4000]);
    const image = { ...uids(), rows: 2, columns: 2, pixels };

    const windowed = readDicomFile(
      syntheticDicomFile({ ...image, windowCenter: 1000, windowWidth: 1000 }),
    );
    const stretched = readDicomFile(syntheticDicomFile(image));

    if (windowed.kind !== "image" || stretched.kind !== "image") throw new Error("not an image");
    // Window 500–1500: 0 is black, 1000 mid-gray, 2000 and 4000 white.
    expect(gray(windowed.frames[0]!)).toEqual([0, 128, 255, 255]);
    expect(gray(stretched.frames[0]!)).toEqual([0, 64, 128, 255]);
  });

  it("does not read the patient's name, ID or birth date", () => {
    const result = readDicomFile(syntheticDicomFile(uids()));

    expect(JSON.stringify(result.kind === "image" && result.info)).not.toMatch(/PHANTOM|19000101/);
  });

  it("recognizes files it cannot or need not show", () => {
    expect(readDicomFile(Buffer.from("not dicom")).kind).toBe("not-dicom");
    expect(readDicomFile(Buffer.alloc(200)).kind).toBe("not-dicom");
    // Without study and series UIDs there is nothing to group the file into (e.g. a DICOMDIR).
    expect(readDicomFile(syntheticDicomFile({ studyUid: "", seriesUid: "" })).kind).toBe(
      "no-image",
    );
    expect(
      readDicomFile(syntheticDicomFile({ ...uids(), transferSyntax: "1.2.840.10008.1.2.4.90" })),
    ).toMatchObject({ kind: "unsupported", frames: 1 });
  });
});
