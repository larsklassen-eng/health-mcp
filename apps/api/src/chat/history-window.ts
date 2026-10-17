import type { ChatMessage } from "@health-mcp/shared";

/**
 * The part of a chat history sent to the model: the newest whole messages
 * whose text fits in `maxChars`, oldest first. It always starts with a user
 * message, so a kept answer never loses its question.
 */
export function recentHistory(
  messages: readonly ChatMessage[],
  maxChars: number,
): { messages: ChatMessage[]; omitted: number } {
  let start = messages.length;
  let chars = 0;
  while (start > 0 && chars + messages[start - 1]!.content.length <= maxChars) {
    start--;
    chars += messages[start]!.content.length;
  }
  while (start < messages.length && messages[start]!.role !== "user") start++;
  return { messages: messages.slice(start), omitted: start };
}
