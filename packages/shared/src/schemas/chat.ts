import { z } from "zod";

import { IdSchema, IsoDateTimeSchema } from "./common.js";

export const ChatRoleSchema = z.enum(["user", "assistant"]);

/** A tool the agent called while producing an assistant message. */
export const ToolCallSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Arguments chosen by the LLM. `patient_id` is added by apps/api, so it is not included here. */
  input: z.record(z.string(), z.unknown()),
  output: z.unknown().optional(),
  isError: z.boolean().default(false),
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

/** Response of `GET /patients/:id/chat`. */
export const ChatHistoryResponseSchema = z.object({
  messages: z.array(ChatMessageSchema),
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
  }),
  z.object({
    type: z.literal("message_end"),
    messageId: IdSchema,
    stopReason: z.string().optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type ChatRole = z.infer<typeof ChatRoleSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type SendChatMessageRequest = z.infer<typeof SendChatMessageRequestSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
export type ChatStreamEventType = ChatStreamEvent["type"];
