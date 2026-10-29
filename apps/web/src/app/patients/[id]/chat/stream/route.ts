import { API_ROUTES, SendChatMessageRequestSchema } from "@health-mcp/shared";

import { apiUrl } from "@/lib/api-client";
import { sessionHeaders } from "@/lib/session";

/** Messages are at most 8000 characters; anything far larger is rejected before parsing. */
const MAX_BODY_BYTES = 64 * 1024;

const jsonError = (status: number, error: string, message: string) =>
  Response.json({ statusCode: status, error, message }, { status });

/**
 * Proxies `POST /patients/:id/chat` to the api and streams its server-sent
 * events back unchanged, so the browser never needs the api's URL. When the
 * browser disconnects, `request.signal` aborts the api request, which stops the model.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return jsonError(413, "Payload Too Large", "The message is too long");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return jsonError(413, "Payload Too Large", "The message is too long");

  let body;
  try {
    body = SendChatMessageRequestSchema.parse(JSON.parse(text));
  } catch {
    return jsonError(400, "Bad Request", "Send a JSON body with a message of 1–8000 characters");
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl()}${API_ROUTES.patientChat(id)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(await sessionHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("Chat proxy could not reach the api", error);
    return jsonError(503, "Service Unavailable", "The api is not reachable");
  }

  if (!upstream.ok || !upstream.body) {
    // Validation and unknown-patient errors are plain JSON; pass them through.
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
