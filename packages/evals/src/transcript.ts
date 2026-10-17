import { ChatStreamEventSchema } from "@health-mcp/shared";

import type { Transcript } from "./eval-case.js";

/** Reads the SSE body of `POST /patients/:id/chat` into a transcript. */
export function parseChatStream(body: string): Transcript {
  const transcript: Transcript = { answer: "", toolCalls: [] };
  const ids: string[] = [];
  let ended = false;

  for (const block of body.split("\n\n")) {
    if (!block.startsWith("data: ")) continue;
    const event = ChatStreamEventSchema.parse(JSON.parse(block.slice("data: ".length)));
    switch (event.type) {
      case "text_delta":
        transcript.answer += event.delta;
        break;
      case "tool_call_start":
        ids.push(event.toolCallId);
        transcript.toolCalls.push({ name: event.name, input: event.input, isError: false });
        break;
      case "tool_call_result": {
        const call = transcript.toolCalls[ids.indexOf(event.toolCallId)];
        if (call) call.isError = event.isError;
        break;
      }
      case "message_end":
        ended = true;
        if (event.stopReason !== undefined) transcript.stopReason = event.stopReason;
        break;
      case "error":
        transcript.error = event.message;
        break;
    }
  }
  if (!ended && transcript.error === undefined)
    transcript.error = "The stream ended without an answer.";
  return transcript;
}
