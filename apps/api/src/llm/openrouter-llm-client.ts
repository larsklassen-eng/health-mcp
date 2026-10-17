import { OpenRouter } from "@openrouter/sdk";
import type { ChatMessages, ChatStreamChunk } from "@openrouter/sdk/models";
import { OpenRouterError, RequestAbortedError } from "@openrouter/sdk/models/errors";

import {
  LlmClient,
  LlmError,
  type LlmMessage,
  type LlmRequest,
  type LlmStreamEvent,
  type LlmToolCall,
  type LlmToolDefinition,
  type LlmUsage,
} from "./llm-client.js";

export interface OpenRouterLlmClientOptions {
  /** When missing, the client still constructs but every request fails with a clear error. */
  apiKey: string | undefined;
  /** OpenRouter model slug, e.g. `anthropic/claude-opus-5.5`. */
  model: string;
  /** Output token cap per turn. OpenRouter checks the account can pay for this many tokens up front. */
  maxTokens: number;
  /**
   * Only use providers with zero data retention. Requests fail if the model has
   * no such provider. Providers that train on data are excluded either way.
   */
  zeroDataRetention: boolean;
  /** Override the API base URL (tests point this at a local fake server). */
  serverURL?: string;
  /** Set to `false` to disable the SDK's automatic retries (tests). */
  retries?: boolean;
}

/** {@link LlmClient} backed by the OpenRouter chat completions API, streamed. */
export class OpenRouterLlmClient extends LlmClient {
  readonly model: string;
  private readonly maxTokens: number;
  private readonly zeroDataRetention: boolean;
  private readonly sdk: OpenRouter | undefined;

  constructor(options: OpenRouterLlmClientOptions) {
    super();
    this.model = options.model;
    this.maxTokens = options.maxTokens;
    this.zeroDataRetention = options.zeroDataRetention;
    this.sdk = options.apiKey
      ? new OpenRouter({
          apiKey: options.apiKey,
          ...(options.serverURL !== undefined && { serverURL: options.serverURL }),
          ...(options.retries === false && { retryConfig: { strategy: "none" as const } }),
        })
      : undefined;
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    if (!this.sdk) throw new LlmError("OPENROUTER_API_KEY is not set");

    let response;
    try {
      response = await this.sdk.chat.send(
        {
          appTitle: "health-mcp",
          chatRequest: {
            model: this.model,
            maxTokens: this.maxTokens,
            messages: request.messages.map(toOpenRouterMessage),
            ...(request.tools?.length && { tools: request.tools.map(toOpenRouterTool) }),
            // Health data: never route to providers that store prompts for training,
            // and (by default) only to providers that keep no data at all.
            provider: { dataCollection: "deny", ...(this.zeroDataRetention && { zdr: true }) },
            stream: true,
            streamOptions: { includeUsage: true },
          },
        },
        signal ? { signal } : undefined,
      );
    } catch (error) {
      throw this.withPolicyHint(toLlmError(error));
    }
    if (!(Symbol.asyncIterator in response))
      throw new LlmError("OpenRouter returned a non-streaming response");

    // Tool calls arrive in fragments keyed by `index`: the first carries id and name,
    // later ones append to the JSON arguments string.
    const toolCalls = new Map<number, LlmToolCall>();
    let finishReason: string | null = null;
    let usage: LlmUsage | undefined;

    try {
      for await (const chunk of response as AsyncIterable<ChatStreamChunk>) {
        if (chunk.error) throw new LlmError(chunk.error.message, { status: chunk.error.code });
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.promptTokens,
            outputTokens: chunk.usage.completionTokens,
          };
        }
        for (const choice of chunk.choices) {
          if (choice.delta.content) yield { type: "text_delta", delta: choice.delta.content };
          for (const fragment of choice.delta.toolCalls ?? []) {
            const call = toolCalls.get(fragment.index) ?? { id: "", name: "", arguments: "" };
            if (fragment.id) call.id = fragment.id;
            if (fragment.function?.name) call.name = fragment.function.name;
            if (fragment.function?.arguments) call.arguments += fragment.function.arguments;
            toolCalls.set(fragment.index, call);
          }
          if (choice.finishReason) finishReason = choice.finishReason;
        }
      }
    } catch (error) {
      throw toLlmError(error);
    }

    for (const [, call] of [...toolCalls].sort(([a], [b]) => a - b)) {
      yield { type: "tool_call", call };
    }
    yield { type: "finish", reason: finishReason ?? "stop", ...(usage && { usage }) };
  }

  /** OpenRouter answers 404 when no provider for the model satisfies the data policy. */
  private withPolicyHint(error: LlmError): LlmError {
    if (error.status !== 404 || !this.zeroDataRetention) return error;
    return new LlmError(
      `${error.message}. OPENROUTER_ZDR=true only allows zero-data-retention providers; ` +
        `check that ${this.model} has one (https://openrouter.ai/docs/features/zdr) or set OPENROUTER_ZDR=false.`,
      { status: error.status, cause: error },
    );
  }
}

function toOpenRouterMessage(message: LlmMessage): ChatMessages {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length && {
          toolCalls: message.toolCalls.map(({ id, name, arguments: args }) => ({
            id,
            type: "function" as const,
            function: { name, arguments: args },
          })),
        }),
      };
    case "tool":
      return { role: "tool", toolCallId: message.toolCallId, content: message.content };
  }
}

const toOpenRouterTool = ({ name, description, parameters }: LlmToolDefinition) => ({
  type: "function" as const,
  function: { name, description, parameters },
});

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (
    error instanceof RequestAbortedError ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new LlmError("LLM request was aborted", { aborted: true, cause: error });
  }
  if (error instanceof OpenRouterError) {
    return new LlmError(`OpenRouter request failed (${error.statusCode}): ${error.body}`, {
      status: error.statusCode,
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LlmError(`OpenRouter request failed: ${message}`, { cause: error });
}
