import { z } from "zod";

import { IdSchema, IsoDateTimeSchema } from "../schemas/common.js";
import { MedicationStatusSchema, MilestoneStatusSchema, VitalTypeSchema } from "../schemas/health-records.js";

/*
 * MCP tool contracts.
 *
 * Each tool has `args`: the fields the LLM is allowed to choose, sent to the
 * model as the tool's JSON Schema. apps/api then adds `patient_id` for the
 * patient whose chat is open, and apps/mcp-server validates the full input
 * (`args` + `patient_id`). The LLM never picks which patient it reads.
 * Tool fields use snake_case, as is conventional for LLM tool arguments.
 */

export const PatientIdArgSchema = z.object({
  patient_id: IdSchema.describe("Patient whose data is accessed. Set by the API, never by the model."),
});

export const MCP_TOOLS = {
  get_patient_profile: {
    description: "Get the current patient's demographics, diagnosis and surgery date.",
    args: z.object({}),
  },
  get_lab_results: {
    description: "Get the current patient's lab results, newest first. Optionally filter by test name or date.",
    args: z.object({
      test_name: z.string().optional().describe("Exact lab test name, e.g. 'Hemoglobin'. Omit for all tests."),
      since: IsoDateTimeSchema.optional().describe("Only results collected at or after this time."),
      limit: z.int().min(1).max(100).default(20).describe("Maximum number of results."),
    }),
  },
  get_vitals_trend: {
    description: "Get readings of one vital sign for the current patient over recent days, oldest first.",
    args: z.object({
      vital_type: VitalTypeSchema.describe("Which vital sign to return."),
      days: z.int().min(1).max(365).default(30).describe("How many days back to look."),
    }),
  },
  get_medications: {
    description: "List the current patient's medications.",
    args: z.object({
      status: z
        .enum([...MedicationStatusSchema.options, "all"])
        .default("active")
        .describe("Filter by medication status."),
    }),
  },
  log_symptom: {
    description: "Record a symptom the current patient reports. Only use when the user explicitly asks to log it.",
    args: z.object({
      name: z.string().min(1).max(200).describe("Symptom name, e.g. 'headache'."),
      severity: z.int().min(0).max(10).describe("0 = none, 10 = worst imaginable."),
      notes: z.string().max(2000).optional().describe("Free-text details from the user."),
    }),
  },
  get_recovery_milestones: {
    description: "List the current patient's recovery milestones and whether they were achieved.",
    args: z.object({
      status: MilestoneStatusSchema.optional().describe("Filter by status. Omit for all milestones."),
    }),
  },
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;

export const McpToolNameSchema = z.enum(Object.keys(MCP_TOOLS) as [McpToolName, ...McpToolName[]]);

/** Arguments the LLM supplies for a tool (no `patient_id`). */
export type McpToolArgs<T extends McpToolName> = z.infer<(typeof MCP_TOOLS)[T]["args"]>;

/** Full input validated by apps/mcp-server: the LLM's arguments plus `patient_id`. */
export type McpToolInput<T extends McpToolName> = McpToolArgs<T> & z.infer<typeof PatientIdArgSchema>;

/** Schema for the full input of a tool, as validated by apps/mcp-server. */
export function mcpToolInputSchema<T extends McpToolName>(name: T) {
  return MCP_TOOLS[name].args.extend(PatientIdArgSchema.shape);
}
