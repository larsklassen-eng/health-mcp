import { McpToolNameSchema } from "@health-mcp/shared";
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
      isError: z.boolean(),
    }),
  ),
  stopReason: z.string().optional(),
  /** Set when the stream reported an error or ended without an answer. */
  error: z.string().optional(),
});

export type Transcript = z.infer<typeof TranscriptSchema>;

export const EvalResultSchema = z.object({
  caseId: z.string(),
  passed: z.boolean(),
  toolCalls: z.array(z.string()),
  failures: z.array(z.string()),
  durationMs: z.number().nonnegative().optional(),
  answer: z.string().optional(),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;
