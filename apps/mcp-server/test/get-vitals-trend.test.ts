import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_RAW_POINTS, type VitalsTrendOutput } from "../src/tools/get-vitals-trend.js";
import { insertPatient, insertVital, startTestServer, type TestServer } from "./helpers.js";

const NOW = new Date("2026-10-15T12:00:00.000Z");

let server: TestServer;
let client: Client;
let patientId: string;
beforeEach(async () => {
  server = await startTestServer({ now: () => NOW });
  client = await server.connect();
  patientId = insertPatient(server.db).id;
});
afterEach(async () => {
  await server.close();
});

const call = async (args: Record<string, unknown>) =>
  (await client.callTool({ name: "get_vitals_trend", arguments: { patient_id: patientId, ...args } })) as CallToolResult;
const text = (result: CallToolResult) => (result.content[0]?.type === "text" ? result.content[0].text : "");
const output = async (args: Record<string, unknown>) => {
  const result = await call(args);
  expect(result.isError).toBeFalsy();
  return JSON.parse(text(result)) as VitalsTrendOutput;
};
/** ISO time `days` before NOW. */
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("get_vitals_trend", () => {
  it("returns one vital's readings in the window oldest first, with a summary", async () => {
    insertVital(server.db, patientId, { value: 80, recordedAt: daysAgo(10) });
    insertVital(server.db, patientId, { value: 72, recordedAt: daysAgo(2) });
    insertVital(server.db, patientId, { value: 76, recordedAt: daysAgo(5) });

    const trend = await output({ vital_type: "heart_rate" });

    expect(trend).toEqual({
      vitalType: "heart_rate",
      unit: "bpm",
      since: daysAgo(30),
      readings: [
        { recordedAt: daysAgo(10), value: 80 },
        { recordedAt: daysAgo(5), value: 76 },
        { recordedAt: daysAgo(2), value: 72 },
      ],
      summary: {
        count: 3,
        min: 72,
        max: 80,
        average: 76,
        first: { recordedAt: daysAgo(10), value: 80 },
        latest: { recordedAt: daysAgo(2), value: 72 },
        change: -8,
      },
    });
  });

  it("only includes the requested vital type", async () => {
    insertVital(server.db, patientId, { value: 80, recordedAt: daysAgo(1) });
    insertVital(server.db, patientId, { type: "weight", unit: "kg", value: 81.4, recordedAt: daysAgo(1) });

    const trend = await output({ vital_type: "weight" });

    expect(trend.unit).toBe("kg");
    expect(trend.readings).toEqual([{ recordedAt: daysAgo(1), value: 81.4 }]);
  });

  it("uses `days` as the window, defaulting to 30, including its exact start", async () => {
    insertVital(server.db, patientId, { value: 1, recordedAt: daysAgo(30) });
    insertVital(server.db, patientId, { value: 2, recordedAt: new Date(NOW.getTime() - 30 * 86_400_000 - 1).toISOString() });
    insertVital(server.db, patientId, { value: 3, recordedAt: daysAgo(6) });

    expect((await output({ vital_type: "heart_rate" })).readings?.map((r) => r.value)).toEqual([1, 3]);
    expect((await output({ vital_type: "heart_rate", days: 7 })).readings?.map((r) => r.value)).toEqual([3]);
  });

  it("rounds the average and change to two decimals", async () => {
    for (const value of [37.1, 37.2, 37.6]) insertVital(server.db, patientId, { type: "temperature", unit: "°C", value, recordedAt: daysAgo(value - 36) });

    const { summary } = await output({ vital_type: "temperature" });

    expect(summary).toMatchObject({ average: 37.3, change: -0.5 });
  });

  it(`switches to daily aggregates above ${MAX_RAW_POINTS} readings`, async () => {
    // 61 days x 2 readings = 122 readings.
    for (let day = 60; day >= 0; day--) {
      insertVital(server.db, patientId, { value: 70, recordedAt: daysAgo(day + 0.4) });
      insertVital(server.db, patientId, { value: 80, recordedAt: daysAgo(day + 0.1) });
    }

    const trend = await output({ vital_type: "heart_rate", days: 90 });

    expect(trend.readings).toBeUndefined();
    expect(trend.daily).toHaveLength(61);
    expect(trend.daily![0]).toEqual({ date: daysAgo(60.4).slice(0, 10), count: 2, min: 70, max: 80, average: 75 });
    expect(trend.summary).toMatchObject({ count: 122, min: 70, max: 80 });
  });

  it("returns raw readings at exactly the limit", async () => {
    for (let i = 0; i < MAX_RAW_POINTS; i++) insertVital(server.db, patientId, { value: 70, recordedAt: daysAgo(i / 10) });

    const trend = await output({ vital_type: "heart_rate" });

    expect(trend.readings).toHaveLength(MAX_RAW_POINTS);
    expect(trend.daily).toBeUndefined();
  });

  it("says when the vital was last recorded if the window is empty", async () => {
    insertVital(server.db, patientId, { value: 80, recordedAt: daysAgo(45) });

    const trend = await output({ vital_type: "heart_rate", days: 7 });

    expect(trend).toMatchObject({ readings: [], summary: null, lastRecordedAt: daysAgo(45) });
  });

  it("returns lastRecordedAt null when the vital was never recorded", async () => {
    expect(await output({ vital_type: "oxygen_saturation" })).toMatchObject({ unit: null, readings: [], summary: null, lastRecordedAt: null });
  });

  it("only returns the requested patient's readings", async () => {
    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" });
    insertVital(server.db, other.id, { value: 120, recordedAt: daysAgo(1) });
    insertVital(server.db, other.id, { value: 110, recordedAt: daysAgo(40) });

    expect(await output({ vital_type: "heart_rate" })).toMatchObject({ readings: [], lastRecordedAt: null });
  });

  it("returns a tool error for an unknown patient", async () => {
    const result = (await client.callTool({ name: "get_vitals_trend", arguments: { patient_id: "does-not-exist", vital_type: "heart_rate" } })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Patient does-not-exist not found.");
  });

  it.each([
    ["a missing vital_type", {}],
    ["an unknown vital_type", { vital_type: "blood_sugar" }],
    ["0 days", { vital_type: "heart_rate", days: 0 }],
    ["more than 365 days", { vital_type: "heart_rate", days: 366 }],
  ])("rejects %s", async (_, args) => {
    expect((await call(args)).isError).toBe(true);
  });
});
