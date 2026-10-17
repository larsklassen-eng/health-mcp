import type { ChatStreamEvent } from "@health-mcp/shared";

import { readChatStream } from "./sse";

/*
 * Browser-side chat client. It calls the web app's own proxy route
 * (`app/patients/[id]/chat/stream/route.ts`), never the api directly.
 */

export const chatStreamPath = (patientId: string): string =>
  `/patients/${encodeURIComponent(patientId)}/chat/stream`;

/** The message could not be sent; `message` is safe to show to the user. */
export class ChatSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatSendError";
  }
}

const SEND_ERRORS: Record<number, string> = {
  404: "This patient no longer exists.",
  413: "The message is too long.",
  503: "The api is not reachable. Start it with `yarn dev` and try again.",
};
export const GENERIC_SEND_ERROR = "The message could not be sent. Please try again.";

/** Sends a message and returns the answer's events. Throws `ChatSendError` if the answer never starts. */
export async function sendChatMessage(
  patientId: string,
  message: string,
  signal: AbortSignal,
): Promise<AsyncGenerator<ChatStreamEvent>> {
  let response: Response;
  try {
    response = await fetch(chatStreamPath(patientId), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ChatSendError(GENERIC_SEND_ERROR);
  }
  if (!response.ok || !response.body)
    throw new ChatSendError(SEND_ERRORS[response.status] ?? GENERIC_SEND_ERROR);
  return readChatStream(response.body);
}
