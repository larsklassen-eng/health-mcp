import { imagingSeries, imagingStudies } from "@health-mcp/db";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ImagingStudiesOutput, MAX_REPORT_CHARS } from "../src/tools/get-imaging-studies.js";
import { insertPatient, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer;
let client: Client;
let patientId: string;
beforeEach(async () => {
  server = await startTestServer();
  client = await server.connect();
  patientId = insertPatient(server.db).id;
});
afterEach(async () => {
  await server.close();
});

const call = async (args: Record<string, unknown>) =>
  (await client.callTool({
    name: "get_imaging_studies",
    arguments: { patient_id: patientId, ...args },
  })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : "";
const output = async (args: Record<string, unknown> = {}) => {
  const result = await call(args);
  expect(result.isError).toBeFalsy();
  return JSON.parse(text(result)) as ImagingStudiesOutput;
};

const insertStudy = (
  values: Partial<typeof imagingStudies.$inferInsert> = {},
  forPatient = patientId,
) =>
  server.db
    .insert(imagingStudies)
    .values({
      patientId: forPatient,
      modality: "MR",
      studyDate: "2026-09-01",
      source: "import",
      ...values,
    })
    .returning()
    .get();

describe("get_imaging_studies", () => {
  it("returns studies newest first with their report and series, without ids", async () => {
    insertStudy({ studyDate: "2026-08-01", modality: "CT", description: "CT head" });
    const mri = insertStudy({
      studyDate: "2026-09-08",
      bodyPart: "Brain",
      description: "MRI brain",
      impression: "Stable.",
      report: "Findings: unchanged. Impression: Stable.",
      source: "dicom",
    });
    server.db
      .insert(imagingSeries)
      .values([
        {
          studyId: mri.id,
          seriesNumber: 3,
          description: "Ax T1 post",
          modality: "MR",
          imageCount: 176,
        },
        { studyId: mri.id, seriesNumber: 1, modality: "MR", imageCount: 3 },
      ])
      .run();

    const { studies, hasMore } = await output();

    expect(studies).toEqual([
      {
        studyDate: "2026-09-08",
        modality: "MR",
        bodyPart: "Brain",
        description: "MRI brain",
        impression: "Stable.",
        report: "Findings: unchanged. Impression: Stable.",
        series: [{ imageCount: 3 }, { description: "Ax T1 post", imageCount: 176 }],
      },
      { studyDate: "2026-08-01", modality: "CT", description: "CT head", series: [] },
    ]);
    expect(hasMore).toBe(false);
  });

  it("filters by modality and limits the number of studies", async () => {
    for (const day of [1, 2, 3]) insertStudy({ studyDate: `2026-09-0${day}` });
    insertStudy({ modality: "CR", studyDate: "2026-09-10" });

    const mri = await output({ modality: "MR", limit: 2 });
    const xray = await output({ modality: "CR" });

    expect(mri.studies.map((s) => s.studyDate)).toEqual(["2026-09-03", "2026-09-02"]);
    expect(mri.hasMore).toBe(true);
    expect(xray.studies.map((s) => s.modality)).toEqual(["CR"]);
  });

  it("shortens very long reports and says so", async () => {
    insertStudy({ report: "x".repeat(MAX_REPORT_CHARS + 10) });

    const [study] = (await output()).studies;

    expect(study?.report).toHaveLength(MAX_REPORT_CHARS);
    expect(study?.reportTruncated).toBe(true);
  });

  it("only returns the requested patient's studies", async () => {
    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" });
    insertStudy({ description: "Someone else's MRI" }, other.id);

    expect(await output()).toEqual({ studies: [], hasMore: false });
  });

  it("returns a tool error for an unknown patient and rejects invalid arguments", async () => {
    const unknown = (await client.callTool({
      name: "get_imaging_studies",
      arguments: { patient_id: "does-not-exist" },
    })) as CallToolResult;

    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toBe("Patient does-not-exist not found.");
    expect((await call({ modality: "mri" })).isError).toBe(true);
    expect((await call({ limit: 21 })).isError).toBe(true);
  });
});
