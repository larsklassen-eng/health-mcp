import { MCP_TOOLS, PatientSchema } from "@health-mcp/shared";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { insertPatient, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer;
let client: Client;
beforeEach(async () => {
  server = await startTestServer();
  client = await server.connect();
});
afterEach(async () => {
  await server.close();
});

const call = async (args: Record<string, unknown>) =>
  (await client.callTool({ name: "get_patient_profile", arguments: args })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : undefined;

describe("tools/list", () => {
  it("lists the tools with the shared descriptions and a required patient_id", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_patient_profile",
      "get_lab_results",
      "get_vitals_trend",
      "get_medications",
      "get_recovery_milestones",
      "log_symptom",
      "get_imaging_studies",
    ]);
    expect(tools.every((tool) => tool.inputSchema.required?.includes("patient_id"))).toBe(true);
    expect(tools[0]).toMatchObject({
      description: MCP_TOOLS.get_patient_profile.description,
      inputSchema: { type: "object", required: ["patient_id"] },
    });
  });
});

describe("get_patient_profile", () => {
  it("returns the patient's profile as JSON", async () => {
    const patient = insertPatient(server.db, { surgeryDate: "2026-09-01" });

    const result = await call({ patient_id: patient.id });

    expect(result.isError).toBeFalsy();
    const profile = PatientSchema.parse(JSON.parse(text(result)!));
    expect(profile).toMatchObject({
      id: patient.id,
      firstName: "Ana",
      diagnosis: "Synthetic meningioma",
      surgeryDate: "2026-09-01",
    });
    // Null columns are omitted, as in the api.
    expect(JSON.parse(text(result)!)).not.toHaveProperty("notes");
  });

  it("only returns the requested patient", async () => {
    insertPatient(server.db, { mrn: "FAKE-1", firstName: "First" });
    const second = insertPatient(server.db, { mrn: "FAKE-2", firstName: "Second" });

    const result = await call({ patient_id: second.id });

    expect(JSON.parse(text(result)!)).toMatchObject({ id: second.id, firstName: "Second" });
  });

  it("returns a tool error for an unknown patient", async () => {
    const result = await call({ patient_id: "does-not-exist" });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Patient does-not-exist not found.");
  });

  it.each([
    ["missing", {}],
    ["empty", { patient_id: "" }],
    ["too long", { patient_id: "x".repeat(65) }],
  ])("rejects a %s patient_id", async (_, args) => {
    const result = await call(args);

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("patient_id");
  });

  it("returns a generic tool error and logs the cause when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    server.db.$client.exec(
      "DROP TABLE recovery_milestones; DROP TABLE lab_results; DROP TABLE vital_signs; " +
        "DROP TABLE medications; DROP TABLE symptoms; DROP TABLE chat_messages; " +
        "DROP TABLE patients",
    );

    const result = await call({ patient_id: "p1" });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe("The get_patient_profile tool failed unexpectedly.");
    expect(log).toHaveBeenCalledWith("Tool get_patient_profile failed", expect.any(Error));
    log.mockRestore();
  });
});
