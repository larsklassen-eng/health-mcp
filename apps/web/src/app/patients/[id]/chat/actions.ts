"use server";

import { IdSchema, type ToolCall, ToolCallDecisionRequestSchema } from "@health-mcp/shared";

import { api, ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

export type ToolCallDecisionResult = { toolCall: ToolCall } | { error: string };

/** Confirms (saves) or discards an entry the assistant proposed, e.g. a symptom to log. */
export async function decideToolCallAction(
  patientId: string,
  toolCallId: string,
  decision: string,
): Promise<ToolCallDecisionResult> {
  // Server actions can be called with any arguments, so check them like a request body.
  const parsed = ToolCallDecisionRequestSchema.safeParse({ decision });
  if (
    !parsed.success ||
    !IdSchema.safeParse(patientId).success ||
    !IdSchema.safeParse(toolCallId).success
  )
    return { error: "Invalid request." };

  try {
    return { toolCall: await api.decideToolCall(patientId, toolCallId, parsed.data.decision) };
  } catch (error) {
    if (error instanceof ApiRequestError && error.body) return { error: error.body.message };
    if (error instanceof ApiUnavailableError) return { error: `${error.message}. Is it running?` };
    return { error: "The entry could not be saved. Please try again." };
  }
}
