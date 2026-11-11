import { ChatUsageSchema, McpToolNameSchema } from "@health-mcp/shared";
import { z } from "zod";

/** A tool call a good answer makes. `args` must match the call's input (strings ignore case). */
export const ExpectedToolCallSchema = z.object({
  name: McpToolNameSchema,
  args: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

/** Text the answer must contain (case-insensitive). A list means any one of them. */
export const AnswerTextSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

/**
 * One eval scenario: a clinician's question in a patient's chat, plus what a
 * good answer must do. Patients come from `fixtures/synthetic-patients.json`
 * (synthetic data only); each case gets a fresh copy with an empty chat.
 */
export const EvalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  /** MRN of a patient in the synthetic fixture. */
  patientMrn: z.string().startsWith("FAKE-"),
  userMessage: z.string().min(1),
  expectedToolCalls: z.array(ExpectedToolCallSchema).default([]),
  forbiddenToolCalls: z.array(McpToolNameSchema).default([]),
  answerIncludes: z.array(AnswerTextSchema).default([]),
  /** Text that must not appear, e.g. values the patient does not have. */
  answerExcludes: z.array(z.string().min(1)).default([]),
  maxToolCalls: z.int().nonnegative().default(8),
  /**
   * Yes/no statements about the answer that an LLM judge checks (see judge.ts),
   * for what depends on meaning rather than wording, e.g. "Says he no longer
   * takes dexamethasone." Costs a judge call per run of the case.
   */
  rubric: z.array(z.string().min(1)).default([]),
  /**
   * Numbers the answer may state without reading them anywhere (see grounding.ts),
   * e.g. a threshold the case asks about. Only silences the warning.
   */
  allowedNumbers: z.array(z.string().regex(/^\d+(\.\d+)?$/)).default([]),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalCaseInput = z.input<typeof EvalCaseSchema>;

/** What the agent did for one case, read from the chat stream. */
export const TranscriptSchema = z.object({
  answer: z.string(),
  toolCalls: z.array(
    z.object({
      name: z.string(),
      input: z.record(z.string(), z.unknown()),
      /** What the tool returned; absent when no result arrived. */
      output: z.unknown().optional(),
      isError: z.boolean(),
    }),
  ),
  stopReason: z.string().optional(),
  /** Tokens and cost of the answer, from `message_end`. */
  usage: ChatUsageSchema.optional(),
  /** Set when the stream reported an error or ended without an answer. */
  error: z.string().optional(),
});

export type Transcript = z.infer<typeof TranscriptSchema>;

export const EvalResultSchema = z.object({
  caseId: z.string(),
  /** Which run of the case this is (1 = first), with `--repeat`. */
  attempt: z.int().positive().optional(),
  passed: z.boolean(),
  toolCalls: z.array(z.string()),
  failures: z.array(z.string()),
  /** Numbers in the answer found in no source: warnings to review, not failures. */
  ungroundedNumbers: z.array(z.object({ value: z.string(), context: z.string() })).default([]),
  durationMs: z.number().nonnegative().optional(),
  /** The arguments and result of each tool call, in order (in the report, for review). */
  toolInputs: z
    .array(
      z.object({
        name: z.string(),
        input: z.record(z.string(), z.unknown()),
        output: z.unknown().optional(),
      }),
    )
    .optional(),
  usage: ChatUsageSchema.optional(),
  /** The judge's verdict on each rubric statement; absent when the case has none. */
  judgeVerdicts: z
    .array(z.object({ criterion: z.string(), met: z.boolean(), reason: z.string() }))
    .optional(),
  /** The judge's own tokens and cost, kept apart from the answer's. */
  judgeUsage: ChatUsageSchema.optional(),
  answer: z.string().optional(),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;
