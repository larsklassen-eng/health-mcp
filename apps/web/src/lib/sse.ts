import { type ChatStreamEvent, ChatStreamEventSchema } from "@health-mcp/shared";

/**
 * Reads the api's chat stream: server-sent events with one JSON `ChatStreamEvent`
 * per `data:` line. Network chunks can split an event anywhere, so text is
 * buffered until the blank line that ends each event.
 */
export async function* readChatStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder(); // `stream: true` keeps multi-byte characters split across chunks intact
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");

      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) yield event;
      }
    }
    const last = parseEvent(buffer + decoder.decode());
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(block: string): ChatStreamEvent | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? ChatStreamEventSchema.parse(JSON.parse(data)) : undefined;
}
