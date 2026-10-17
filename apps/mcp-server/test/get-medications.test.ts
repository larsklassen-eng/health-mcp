import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MedicationsOutput } from "../src/tools/get-medications.js";
import { insertMedication, insertPatient, startTestServer, type TestServer } from "./helpers.js";

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
    name: "get_medications",
    arguments: { patient_id: patientId, ...args },
  })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : "";
const output = async (args: Record<string, unknown> = {}) => {
  const result = await call(args);
  expect(result.isError).toBeFalsy();
  return JSON.parse(text(result)) as MedicationsOutput;
};
const names = async (args: Record<string, unknown> = {}) =>
  (await output(args)).medications.map((m) => m.name);

const seed = () => {
  insertMedication(server.db, patientId, { name: "Levetiracetam", startDate: "2026-08-10" });
  insertMedication(server.db, patientId, {
    name: "Dexamethasone",
    status: "stopped",
    startDate: "2026-08-12",
    endDate: "2026-09-20",
  });
  insertMedication(server.db, patientId, { name: "Pantoprazole", startDate: "2026-08-12" });
  insertMedication(server.db, patientId, { name: "Acetaminophen", startDate: "2026-08-12" });
};

describe("get_medications", () => {
  it("returns active medications by default, without ids, with null fields omitted", async () => {
    insertMedication(server.db, patientId, {
      name: "Levetiracetam",
      dosage: "500 mg",
      route: "oral",
      startDate: "2026-08-10",
    });
    insertMedication(server.db, patientId, { name: "Dexamethasone", status: "stopped" });

    expect(await output()).toEqual({
      medications: [
        {
          name: "Levetiracetam",
          dosage: "500 mg",
          frequency: "twice daily",
          route: "oral",
          status: "active",
          startDate: "2026-08-10",
        },
      ],
    });
  });

  it("orders by start date, newest first, then by name", async () => {
    seed();

    expect(await names()).toEqual(["Acetaminophen", "Pantoprazole", "Levetiracetam"]);
  });

  it("returns only stopped medications, with their end date", async () => {
    seed();

    const { medications } = await output({ status: "stopped" });

    expect(medications).toMatchObject([{ name: "Dexamethasone", endDate: "2026-09-20" }]);
  });

  it("returns all medications with the active ones first", async () => {
    seed();

    expect(await names({ status: "all" })).toEqual([
      "Acetaminophen",
      "Pantoprazole",
      "Levetiracetam",
      "Dexamethasone",
    ]);
  });

  it("only returns the requested patient's medications", async () => {
    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" });
    insertMedication(server.db, other.id, { name: "Temozolomide" });
    insertMedication(server.db, patientId, { name: "Levetiracetam" });

    expect(await names({ status: "all" })).toEqual(["Levetiracetam"]);
  });

  it("returns an empty list for a patient without medications", async () => {
    expect(await output({ status: "all" })).toEqual({ medications: [] });
  });

  it("returns a tool error for an unknown patient", async () => {
    const result = (await client.callTool({
      name: "get_medications",
      arguments: { patient_id: "does-not-exist" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Patient does-not-exist not found.");
  });

  it("rejects an unknown status", async () => {
    expect((await call({ status: "paused" })).isError).toBe(true);
  });
});
