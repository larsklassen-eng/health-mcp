import { z } from "zod";

import { IdSchema, IsoDateTimeSchema } from "../schemas/common.js";
import {
  MedicationStatusSchema,
  MilestoneStatusSchema,
  VitalTypeSchema,
} from "../schemas/health-records.js";
import { ModalitySchema } from "../schemas/imaging.js";
import { ChunkSourceTypeSchema } from "../schemas/record-chunks.js";

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
  patient_id: IdSchema.describe(
    "Patient whose data is accessed. Set by the API, never by the model.",
  ),
});

export const MCP_TOOLS = {
  get_patient_profile: {
    description: "Get the current patient's demographics, diagnosis and surgery date.",
    args: z.object({}),
  },
  get_lab_results: {
    description:
      "Get the current patient's lab results, newest first. " +
      "Optionally filter by test names or date.",
    args: z.object({
      test_names: z
        .array(z.string().min(1).max(200))
        .min(1)
        .max(20)
        .optional()
        .describe(
          "Exact lab test names, e.g. ['Hemoglobin', 'Platelets']. " +
            "Ask for every test you need in one call. Omit for all tests.",
        ),
      since: IsoDateTimeSchema.optional().describe("Only results collected at or after this time."),
      limit: z.int().min(1).max(100).default(20).describe("Maximum number of results."),
    }),
  },
  get_vitals_trend: {
    description:
      "Get readings of one vital sign for the current patient over recent days, oldest first.",
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
    description:
      "Record a symptom for the current patient. " +
      "Only use when the clinician asks to log or record it. " +
      "Nothing is saved until the clinician confirms it in the chat.",
    args: z.object({
      name: z.string().min(1).max(200).describe("Symptom name, e.g. 'headache'."),
      severity: z.int().min(0).max(10).describe("0 = none, 10 = worst imaginable."),
      notes: z.string().max(2000).optional().describe("Free-text details from the user."),
    }),
  },
  get_recovery_milestones: {
    description: "List the current patient's recovery milestones and whether they were achieved.",
    args: z.object({
      status: MilestoneStatusSchema.optional().describe(
        "Filter by status. Omit for all milestones.",
      ),
    }),
  },
  get_imaging_studies: {
    description:
      "Get the current patient's imaging studies (MRI, CT, X-ray), newest first, with their " +
      "radiology reports. You get the reports and study details only, not the images.",
    args: z.object({
      modality: ModalitySchema.optional().describe(
        "DICOM modality code: 'MR' (MRI), 'CT', 'CR' or 'DX' (X-ray), 'US'. Omit for all.",
      ),
      limit: z.int().min(1).max(20).default(5).describe("Maximum number of studies."),
    }),
  },
  search_patient_records: {
    description:
      "Search the current patient's free text by meaning and keywords: radiology reports, " +
      "clinician notes, symptom notes and the clinician's earlier chat messages. Use it when " +
      "the answer may only be written in text, e.g. whether something was mentioned before. " +
      "Returns passages with their source and date; cite them. Passages can be loosely " +
      "related, so check that each one answers the question. No results means nothing " +
      "relevant was found.",
    args: z.object({
      query: z
        .string()
        .min(2)
        .max(500)
        .describe("What to look for, in plain words, e.g. 'dizziness' or 'residual tumor'."),
      sources: z
        .array(ChunkSourceTypeSchema)
        .min(1)
        .optional()
        .describe("Only these kinds of text. Omit to search all of them."),
      limit: z.int().min(1).max(10).default(5).describe("Maximum number of passages."),
    }),
  },
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;

/**
 * Tools that change patient data. apps/api never runs them when the model
 * asks; it shows the call to the clinician, and only runs it once they confirm.
 */
export const TOOLS_REQUIRING_CONFIRMATION: readonly McpToolName[] = ["log_symptom"];

export const requiresConfirmation = (name: string): boolean =>
  (TOOLS_REQUIRING_CONFIRMATION as readonly string[]).includes(name);

export const McpToolNameSchema = z.enum(Object.keys(MCP_TOOLS) as [McpToolName, ...McpToolName[]]);

/** Arguments the LLM supplies for a tool (no `patient_id`). */
export type McpToolArgs<T extends McpToolName> = z.infer<(typeof MCP_TOOLS)[T]["args"]>;

/** Full input validated by apps/mcp-server: the LLM's arguments plus `patient_id`. */
export type McpToolInput<T extends McpToolName> = McpToolArgs<T> &
  z.infer<typeof PatientIdArgSchema>;

/** Schema for the full input of a tool, as validated by apps/mcp-server. */
export function mcpToolInputSchema<T extends McpToolName>(name: T): z.ZodType<McpToolInput<T>> {
  // TypeScript cannot follow `extend` through the generic index, so the result
  // type is stated explicitly.
  return MCP_TOOLS[name].args.extend(PatientIdArgSchema.shape) as unknown as z.ZodType<
    McpToolInput<T>
  >;
}
