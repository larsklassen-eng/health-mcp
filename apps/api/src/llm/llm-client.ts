/*
 * Provider-neutral LLM contract. The agent (step 6+) depends only on this,
 * so tests can swap in a fake and the provider can change without touching it.
 */

export interface LlmToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments exactly as the model produced them. Parse and validate before use. */
  arguments: string;
}

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** `stop` and `tool_calls` are the normal endings; `length` means the output hit the token limit. */
export type LlmFinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "error" | (string & {});

/**
 * Events from {@link LlmClient.stream}, in order: any number of `text_delta`,
 * then each complete `tool_call`, then exactly one `finish`.
 */
export type LlmStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; call: LlmToolCall }
  | { type: "finish"; reason: LlmFinishReason; usage?: LlmUsage };

export class LlmError extends Error {
  /** HTTP status from the provider, when there was one. */
  readonly status: number | undefined;
  /** True when the caller aborted the request (e.g. the user closed the chat). */
  readonly aborted: boolean;

  constructor(message: string, options: { status?: number | undefined; aborted?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "LlmError";
    this.status = options.status;
    this.aborted = options.aborted ?? false;
  }
}

/** Injection token and base class for the chat model client. */
export abstract class LlmClient {
  /** Model identifier, for logging. */
  abstract readonly model: string;

  /** Streams one model turn. Throws {@link LlmError} on failure. */
  abstract stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent>;
}
