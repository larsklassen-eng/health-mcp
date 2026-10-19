import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LabResultsOutput } from "../src/tools/get-lab-results.js";
import { insertLab, insertPatient, startTestServer, type TestServer } from "./helpers.js";

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
    name: "get_lab_results",
    arguments: { patient_id: patientId, ...args },
  })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : "";
const output = async (args: Record<string, unknown> = {}) => {
  const result = await call(args);
  expect(result.isError).toBeFalsy();
  return JSON.parse(text(result)) as LabResultsOutput;
};

describe("get_lab_results", () => {
  it("returns results newest first, without ids, with null fields omitted", async () => {
    insertLab(server.db, patientId, { collectedAt: "2026-09-01T08:00:00.000Z", value: 13.9 });
    insertLab(server.db, patientId, {
      testName: "Platelets",
      value: 139,
      unit: "10^3/uL",
      referenceLow: 150,
      referenceHigh: 400,
      flag: "low",
      collectedAt: "2026-10-12T08:00:00.000Z",
    });

    const { results, hasMore } = await output();

    expect(results).toEqual([
      {
        testName: "Platelets",
        value: 139,
        unit: "10^3/uL",
        referenceLow: 150,
        referenceHigh: 400,
        flag: "low",
        collectedAt: "2026-10-12T08:00:00.000Z",
      },
      {
        testName: "Hemoglobin",
        value: 13.9,
        unit: "g/dL",
        collectedAt: "2026-09-01T08:00:00.000Z",
      },
    ]);
    expect(hasMore).toBe(false);
  });

  it("orders results drawn at the same time by test name", async () => {
    for (const testName of ["Sodium", "ALT", "Hemoglobin"])
      insertLab(server.db, patientId, { testName, collectedAt: "2026-10-12T08:00:00.000Z" });

    const { results } = await output();

    expect(results.map((r) => r.testName)).toEqual(["ALT", "Hemoglobin", "Sodium"]);
  });

  it("filters by test name, ignoring case and surrounding spaces", async () => {
    insertLab(server.db, patientId, {
      testName: "Hemoglobin",
      collectedAt: "2026-10-01T08:00:00.000Z",
    });
    insertLab(server.db, patientId, {
      testName: "Platelets",
      collectedAt: "2026-10-01T08:00:00.000Z",
    });

    const { results, availableTests } = await output({ test_names: [" hemoglobin "] });

    expect(results.map((r) => r.testName)).toEqual(["Hemoglobin"]);
    expect(availableTests).toBeUndefined();
  });

  it("returns several tests in one call", async () => {
    for (const testName of ["Hemoglobin", "Platelets", "ALT"])
      insertLab(server.db, patientId, { testName, collectedAt: "2026-10-01T08:00:00.000Z" });

    const found = await output({ test_names: ["PLATELETS", "hemoglobin"] });

    expect(found.results.map((r) => r.testName)).toEqual(["Hemoglobin", "Platelets"]);
    expect(found).not.toHaveProperty("unknownTests");
  });

  it("lists the available test names when the filter matches nothing", async () => {
    insertLab(server.db, patientId, {
      testName: "Platelets",
      collectedAt: "2026-10-01T08:00:00.000Z",
    });
    insertLab(server.db, patientId, { testName: "ALT", collectedAt: "2026-10-02T08:00:00.000Z" });
    insertLab(server.db, patientId, { testName: "ALT", collectedAt: "2026-10-03T08:00:00.000Z" });

    const { results, unknownTests, availableTests } = await output({ test_names: ["Hgb"] });

    expect(results).toEqual([]);
    expect(unknownTests).toEqual(["Hgb"]);
    expect(availableTests).toEqual(["ALT", "Platelets"]);
  });

  it("returns the tests it found and names the ones it did not", async () => {
    insertLab(server.db, patientId, { testName: "ALT", collectedAt: "2026-10-02T08:00:00.000Z" });

    const { results, unknownTests, availableTests } = await output({
      test_names: ["alt", "Vitamin D"],
    });

    expect(results.map((r) => r.testName)).toEqual(["ALT"]);
    expect(unknownTests).toEqual(["Vitamin D"]);
    expect(availableTests).toEqual(["ALT"]);
  });

  it("returns results at or after `since`, comparing in UTC", async () => {
    insertLab(server.db, patientId, { value: 1, collectedAt: "2026-10-01T02:59:59.000Z" });
    insertLab(server.db, patientId, { value: 2, collectedAt: "2026-10-01T03:00:00.000Z" });
    insertLab(server.db, patientId, { value: 3, collectedAt: "2026-10-05T08:00:00.000Z" });

    // Midnight at UTC-3 is 03:00 UTC.
    const { results } = await output({ since: "2026-10-01T00:00:00-03:00" });

    expect(results.map((r) => r.value)).toEqual([3, 2]);
  });

  it("applies the default limit of 20 and reports when there are more", async () => {
    for (let day = 1; day <= 25; day++)
      insertLab(server.db, patientId, {
        value: day,
        collectedAt: `2026-09-${String(day).padStart(2, "0")}T08:00:00.000Z`,
      });

    const first = await output();
    const limited = await output({ limit: 5 });
    const all = await output({ limit: 100 });

    expect(first.results).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(limited.results.map((r) => r.value)).toEqual([25, 24, 23, 22, 21]);
    expect(all.results).toHaveLength(25);
    expect(all.hasMore).toBe(false);
  });

  it("only returns the requested patient's results", async () => {
    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" });
    insertLab(server.db, other.id, {
      testName: "Glucose",
      collectedAt: "2026-10-01T08:00:00.000Z",
    });
    insertLab(server.db, patientId, {
      testName: "Hemoglobin",
      collectedAt: "2026-10-01T08:00:00.000Z",
    });

    const { results } = await output();

    expect(results.map((r) => r.testName)).toEqual(["Hemoglobin"]);
  });

  it("does not offer another patient's test names in availableTests", async () => {
    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" });
    insertLab(server.db, other.id, {
      testName: "Secret test",
      collectedAt: "2026-10-01T08:00:00.000Z",
    });

    const { availableTests } = await output({ test_names: ["x"] });

    expect(availableTests).toEqual([]);
  });

  it("returns an empty list for a patient without results", async () => {
    expect(await output()).toEqual({ results: [], hasMore: false });
  });

  it("returns a tool error for an unknown patient", async () => {
    const result = (await client.callTool({
      name: "get_lab_results",
      arguments: { patient_id: "does-not-exist" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Patient does-not-exist not found.");
  });

  it.each([
    ["a limit above 100", { limit: 101 }],
    ["a limit of 0", { limit: 0 }],
    ["a since that is not a timestamp", { since: "last week" }],
    ["an empty list of test names", { test_names: [] }],
  ])("rejects %s", async (_, args) => {
    const result = await call(args);

    expect(result.isError).toBe(true);
  });
});
