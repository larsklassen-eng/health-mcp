import { z } from "zod";

import { IdSchema, IsoDateTimeSchema } from "./common.js";

export const ChatRoleSchema = z.enum(["user", "assistant"]);

/**
 * For tools that change data (see `TOOLS_REQUIRING_CONFIRMATION`): `pending`
 * until the clinician decides, then `confirmed` (the tool ran) or `rejected`.
 */
export const ToolCallConfirmationSchema = z.enum(["pending", "confirmed", "rejected"]);

/** A tool the agent called while producing an assistant message. */
export const ToolCallSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Arguments chosen by the LLM. `patient_id` is added by apps/api, so it is not included here. */
  input: z.record(z.string(), z.unknown()),
  output: z.unknown().optional(),
  isError: z.boolean().default(false),
  confirmation: ToolCallConfirmationSchema.optional(),
});

/** A stored message in one patient's chat history. */
export const ChatMessageSchema = z.object({
  id: IdSchema,
  patientId: IdSchema,
  role: ChatRoleSchema,
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).default([]),
  createdAt: IsoDateTimeSchema,
});

/** Body of `POST /patients/:id/chat`. */
export const SendChatMessageRequestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
});

/** Body of `POST /patients/:id/chat/tool-calls/:toolCallId/decision`. Returns the updated `ToolCall`. */
export const ToolCallDecisionRequestSchema = z.object({
  decision: z.enum(["confirm", "reject"]),
});

/** Response of `GET /patients/:id/chat`. */
export const ChatHistoryResponseSchema = z.object({
  messages: z.array(ChatMessageSchema),
});

/** Tokens and cost of one answer, summed over all of its model calls. */
export const ChatUsageSchema = z.object({
  /** Model requests made for the answer (one per round of tool calls, plus the final one). */
  modelCalls: z.int().nonnegative(),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  /** Input tokens read from the provider's prompt cache, when it reports them. */
  cachedInputTokens: z.int().nonnegative().optional(),
  /** Cost in USD as reported by OpenRouter, when it reports it. */
  costUsd: z.number().nonnegative().optional(),
});

/**
 * Events streamed over SSE from `POST /patients/:id/chat`.
 * Each SSE `data:` line is one JSON-encoded event.
 */
export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_start"), messageId: IdSchema }),
  z.object({ type: z.literal("text_delta"), delta: z.string() }),
  z.object({
    type: z.literal("tool_call_start"),
    toolCallId: IdSchema,
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("tool_call_result"),
    toolCallId: IdSchema,
    output: z.unknown(),
    isError: z.boolean(),
    /** `pending` when the tool did not run and waits for the clinician to confirm it. */
    confirmation: z.literal("pending").optional(),
  }),
  z.object({
    type: z.literal("message_end"),
    messageId: IdSchema,
    stopReason: z.string().optional(),
    usage: ChatUsageSchema.optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type ChatRole = z.infer<typeof ChatRoleSchema>;
export type ChatUsage = z.infer<typeof ChatUsageSchema>;
export type ToolCallConfirmation = z.infer<typeof ToolCallConfirmationSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolCallDecisionRequest = z.infer<typeof ToolCallDecisionRequestSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type SendChatMessageRequest = z.infer<typeof SendChatMessageRequestSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
export type ChatStreamEventType = ChatStreamEvent["type"];
