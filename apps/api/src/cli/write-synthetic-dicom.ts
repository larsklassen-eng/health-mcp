import path from "node:path";

import { REPO_ROOT } from "@health-mcp/db";

import { writeSyntheticStudyZip } from "../imaging/synthetic-dicom.js";

/*
 * Writes a zip with a synthetic phantom MRI study (2 series), to try the
 * DICOM upload and the viewer without real scans.
 * Usage: `yarn imaging:synthetic [output.zip]` (default: data/synthetic-mri.zip).
 */
const output = path.resolve(REPO_ROOT, process.argv[2] ?? "data/synthetic-mri.zip");
await writeSyntheticStudyZip(output);
console.log(`Wrote ${path.relative(REPO_ROOT, output)}: a synthetic MRI study to upload.`);
