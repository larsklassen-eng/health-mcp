import { symptoms } from "@health-mcp/db";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LogSymptomOutput } from "../src/tools/log-symptom.js";
import { insertPatient, startTestServer, type TestServer } from "./helpers.js";

const NOW = new Date("2026-10-19T09:30:00.000Z");

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
  (await client.callTool({
    name: "log_symptom",
    arguments: { patient_id: patientId, ...args },
  })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : "";
const saved = () =>
  server.db.select().from(symptoms).where(eq(symptoms.patientId, patientId)).all();

describe("log_symptom", () => {
  it("saves the symptom, recorded now, and returns it", async () => {
    const result = await call({ name: " Headache ", severity: 4, notes: " Worse in the morning " });

    expect(result.isError).toBeFalsy();
    const expected = {
      name: "Headache",
      severity: 4,
      notes: "Worse in the morning",
      recordedAt: NOW.toISOString(),
    };
    expect(JSON.parse(text(result)) as LogSymptomOutput).toEqual({ symptom: expected });
    expect(saved()).toEqual([expect.objectContaining({ ...expected, patientId })]);
  });

  it("leaves out empty notes", async () => {
    const { symptom } = JSON.parse(
      text(await call({ name: "Fatigue", severity: 2, notes: "  " })),
    ) as LogSymptomOutput;

    expect(symptom).not.toHaveProperty("notes");
    expect(saved()[0]?.notes).toBeNull();
  });

  it.each([
    ["a severity above 10", { name: "Headache", severity: 11 }],
    ["a fractional severity", { name: "Headache", severity: 2.5 }],
    ["an empty name", { name: "", severity: 2 }],
    ["a missing severity", { name: "Headache" }],
  ])("rejects %s without saving", async (_, args) => {
    expect((await call(args)).isError).toBe(true);
    expect(saved()).toEqual([]);
  });

  it("returns a tool error for an unknown patient", async () => {
    const result = (await client.callTool({
      name: "log_symptom",
      arguments: { patient_id: "does-not-exist", name: "Headache", severity: 3 },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Patient does-not-exist not found.");
  });
});
