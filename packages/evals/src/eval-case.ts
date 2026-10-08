import { z } from "zod";

/**
 * One eval scenario: a user message sent to a patient's chat, plus what a
 * good agent response must do. Fixtures must use synthetic patients only.
 */
export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  patientId: z.string().min(1),
  userMessage: z.string().min(1),
  expectedToolCalls: z.array(z.string()).default([]),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalResultSchema = z.object({
  caseId: z.string(),
  passed: z.boolean(),
  toolCalls: z.array(z.string()),
  failures: z.array(z.string()),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;
