import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  MCP_TOOLS,
  type McpToolName,
  McpToolNameSchema,
  mcpToolInputSchema,
  requiresConfirmation,
} from "../src/index.js";

const toolNames = Object.keys(MCP_TOOLS) as McpToolName[];

describe("MCP tool contracts", () => {
  it("exposes every tool name through McpToolNameSchema", () => {
    expect(McpToolNameSchema.options).toEqual(toolNames);
  });

  describe.each(toolNames)("%s", (name) => {
    it("has a description for the LLM", () => {
      expect(MCP_TOOLS[name].description.length).toBeGreaterThan(10);
    });

    it("never lets the LLM choose patient_id", () => {
      const jsonSchema = z.toJSONSchema(MCP_TOOLS[name].args, { io: "input" });
      expect(jsonSchema.properties ?? {}).not.toHaveProperty("patient_id");
    });

    it("requires patient_id in the full server-side input", () => {
      const result = mcpToolInputSchema(name).safeParse({});
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "patient_id")).toBe(true);
    });
  });

  it("applies argument defaults", () => {
    expect(mcpToolInputSchema("get_lab_results").parse({ patient_id: "p1" })).toEqual({
      patient_id: "p1",
      limit: 20,
    });
    expect(mcpToolInputSchema("get_medications").parse({ patient_id: "p1" })).toEqual({
      patient_id: "p1",
      status: "active",
    });
    expect(
      mcpToolInputSchema("get_vitals_trend").parse({ patient_id: "p1", vital_type: "pain_score" })
        .days,
    ).toBe(30);
  });

  it("validates argument ranges", () => {
    const logSymptom = mcpToolInputSchema("log_symptom");
    expect(logSymptom.safeParse({ patient_id: "p1", name: "headache", severity: 11 }).success).toBe(
      false,
    );
    expect(logSymptom.safeParse({ patient_id: "p1", name: "headache", severity: 4 }).success).toBe(
      true,
    );
    expect(
      mcpToolInputSchema("get_lab_results").safeParse({ patient_id: "p1", limit: 500 }).success,
    ).toBe(false);
  });

  it("takes several lab test names in one call, but not an empty list", () => {
    const schema = mcpToolInputSchema("get_lab_results");
    expect(schema.safeParse({ patient_id: "p1", test_names: ["WBC", "ANC"] }).success).toBe(true);
    expect(schema.safeParse({ patient_id: "p1", test_names: [] }).success).toBe(false);
    expect(schema.safeParse({ patient_id: "p1", test_names: "WBC" }).success).toBe(false);
  });
});

describe("requiresConfirmation", () => {
  it("is true only for tools that change patient data", () => {
    expect(toolNames.filter(requiresConfirmation)).toEqual([
      "log_symptom",
      "update_patient_profile",
      "add_medication",
      "update_medication",
    ]);
    expect(requiresConfirmation("unknown_tool")).toBe(false);
  });
});

describe("tools that change records", () => {
  const input = (name: McpToolName, args: Record<string, unknown>) =>
    mcpToolInputSchema(name).safeParse({ patient_id: "p1", ...args }).success;

  it("need at least one change, also with patient_id added", () => {
    expect(input("update_patient_profile", {})).toBe(false);
    expect(input("update_patient_profile", { add_note: "  " })).toBe(false);
    expect(input("update_patient_profile", { add_note: "Resection was gross total." })).toBe(true);
    expect(input("update_medication", { medication_id: "m1", medication_name: "Dex" })).toBe(false);
    expect(
      input("update_medication", { medication_id: "m1", medication_name: "Dex", stop: true }),
    ).toBe(true);
  });

  it("take an end date only when stopping a medication", () => {
    const base = { medication_id: "m1", medication_name: "Dex", dosage: "2 mg" };
    expect(input("update_medication", { ...base, end_date: "2026-11-20" })).toBe(false);
    expect(input("update_medication", { ...base, stop: true, end_date: "2026-11-20" })).toBe(true);
  });
});
