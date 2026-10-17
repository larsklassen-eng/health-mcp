import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecoveryMilestonesOutput } from "../src/tools/get-recovery-milestones.js";
import { insertMilestone, insertPatient, startTestServer, type TestServer } from "./helpers.js";

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
    name: "get_recovery_milestones",
    arguments: { patient_id: patientId, ...args },
  })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : "";
const output = async (args: Record<string, unknown> = {}) => {
  const result = await call(args);
  expect(result.isError).toBeFalsy();
  return JSON.parse(text(result)) as RecoveryMilestonesOutput;
};
const titles = async (args: Record<string, unknown> = {}) =>
  (await output(args)).milestones.map((m) => m.title);

const seed = () => {
  insertMilestone(server.db, patientId, { title: "Return to work", targetDate: "2027-01-15" });
  insertMilestone(server.db, patientId, { title: "Drive again" });
  insertMilestone(server.db, patientId, {
    title: "Walk 1 km unaided",
    status: "achieved",
    targetDate: "2026-09-15",
    achievedAt: "2026-09-10T10:00:00.000Z",
  });
  insertMilestone(server.db, patientId, {
    title: "First follow-up MRI",
    status: "missed",
    targetDate: "2026-10-01",
  });
  insertMilestone(server.db, patientId, { title: "Climb stairs", targetDate: "2026-10-01" });
};

describe("get_recovery_milestones", () => {
  it("returns milestones without ids, with null fields omitted, and counts", async () => {
    insertMilestone(server.db, patientId, {
      title: "Walk 1 km unaided",
      description: "Synthetic milestone",
      status: "achieved",
      targetDate: "2026-09-15",
      achievedAt: "2026-09-10T10:00:00.000Z",
    });
    insertMilestone(server.db, patientId, { title: "Drive again" });

    expect(await output()).toEqual({
      milestones: [
        {
          title: "Walk 1 km unaided",
          description: "Synthetic milestone",
          status: "achieved",
          targetDate: "2026-09-15",
          achievedAt: "2026-09-10T10:00:00.000Z",
        },
        { title: "Drive again", status: "pending" },
      ],
      counts: { pending: 1, achieved: 1, missed: 0 },
    });
  });

  it("orders by target date, then title, with undated milestones last", async () => {
    seed();

    expect(await titles()).toEqual([
      "Walk 1 km unaided",
      "Climb stairs",
      "First follow-up MRI",
      "Return to work",
      "Drive again",
    ]);
  });

  it("filters by status but still counts every status", async () => {
    seed();

    const { milestones, counts } = await output({ status: "pending" });

    expect(milestones.map((m) => m.title)).toEqual([
      "Climb stairs",
      "Return to work",
      "Drive again",
    ]);
    expect(counts).toEqual({ pending: 3, achieved: 1, missed: 1 });
  });

  it("only returns and counts the requested patient's milestones", async () => {
    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" });
    insertMilestone(server.db, other.id, { title: "Other patient's goal", status: "missed" });
    insertMilestone(server.db, patientId, { title: "Drive again" });

    const { milestones, counts } = await output();

    expect(milestones.map((m) => m.title)).toEqual(["Drive again"]);
    expect(counts).toEqual({ pending: 1, achieved: 0, missed: 0 });
  });

  it("returns an empty list for a patient without milestones", async () => {
    expect(await output()).toEqual({
      milestones: [],
      counts: { pending: 0, achieved: 0, missed: 0 },
    });
  });

  it("returns a tool error for an unknown patient", async () => {
    const result = (await client.callTool({
      name: "get_recovery_milestones",
      arguments: { patient_id: "does-not-exist" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Patient does-not-exist not found.");
  });

  it("rejects an unknown status", async () => {
    expect((await call({ status: "done" })).isError).toBe(true);
  });
});
