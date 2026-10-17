// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readChatStream } from "@/lib/sse";

const streamOf = (...chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  });

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const events = [];
  for await (const event of readChatStream(stream)) events.push(event);
  return events;
};

describe("readChatStream", () => {
  it("parses several events from one chunk", async () => {
    const events = await collect(
      streamOf(
        'data: {"type":"message_start","messageId":"m1"}\n\ndata: {"type":"text_delta","delta":"Hi"}\n\n',
      ),
    );
    expect(events).toEqual([
      { type: "message_start", messageId: "m1" },
      { type: "text_delta", delta: "Hi" },
    ]);
  });

  it("joins an event split across chunks", async () => {
    const events = await collect(
      streamOf('data: {"type":"text_', 'delta","delta":"He', 'llo"}\n', "\n"),
    );
    expect(events).toEqual([{ type: "text_delta", delta: "Hello" }]);
  });

  it("keeps a multi-byte character that is split between chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"type":"text_delta","delta":"10 µg"}\n\n');
    const middle = bytes.indexOf(0xc2) + 1; // inside the two bytes of "µ"
    const events = await collect(streamOf(bytes.slice(0, middle), bytes.slice(middle)));
    expect(events).toEqual([{ type: "text_delta", delta: "10 µg" }]);
  });

  it("accepts CRLF line endings, ignores comments and reads a final event without a blank line", async () => {
    const events = await collect(
      streamOf(': keep-alive\r\n\r\ndata: {"type":"error","message":"x"}'),
    );
    expect(events).toEqual([{ type: "error", message: "x" }]);
  });

  it("rejects events that do not match the shared schema", async () => {
    await expect(collect(streamOf('data: {"type":"unknown"}\n\n'))).rejects.toThrow();
  });
});
