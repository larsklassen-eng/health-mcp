import { LlmClient, LlmError, type LlmRequest, type LlmStreamEvent, type LlmToolCall } from "../../src/llm/llm-client.js";

/**
 * Scripted {@link LlmClient} for tests. Queue one turn per expected model call;
 * every request is recorded in `requests` for assertions.
 */
export class FakeLlmClient extends LlmClient {
  readonly model = "fake/model";
  readonly requests: LlmRequest[] = [];
  private readonly turns: LlmStreamEvent[][] = [];

  /** Queues a turn that streams `text` in a few deltas and stops. */
  replyWithText(text: string): this {
    const deltas = text.match(/.{1,8}/gs) ?? [];
    return this.enqueue([...deltas.map((delta) => ({ type: "text_delta" as const, delta })), { type: "finish", reason: "stop" }]);
  }

  /** Queues a turn that requests the given tool calls (arguments are JSON-encoded). */
  replyWithToolCalls(...calls: { id: string; name: string; arguments: unknown }[]): this {
    const events: LlmStreamEvent[] = calls.map(({ id, name, arguments: args }) => ({
      type: "tool_call",
      call: { id, name, arguments: JSON.stringify(args) } satisfies LlmToolCall,
    }));
    return this.enqueue([...events, { type: "finish", reason: "tool_calls" }]);
  }

  /** Queues a turn that fails with `error` after emitting `before`. */
  failWith(error: LlmError, before: LlmStreamEvent[] = []): this {
    this.turns.push([...before, { type: "__throw__", error } as unknown as LlmStreamEvent]);
    return this;
  }

  enqueue(events: LlmStreamEvent[]): this {
    this.turns.push(events);
    return this;
  }

  get remainingTurns(): number {
    return this.turns.length;
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    this.requests.push(structuredClone(request));
    const turn = this.turns.shift();
    if (!turn) throw new Error("FakeLlmClient: the test did not script a turn for this request");

    for (const event of turn) {
      if (signal?.aborted) throw new LlmError("LLM request was aborted", { aborted: true });
      if ((event as { type: string }).type === "__throw__") throw (event as unknown as { error: LlmError }).error;
      await Promise.resolve(); // yield to the event loop like a real stream
      yield event;
    }
  }
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
