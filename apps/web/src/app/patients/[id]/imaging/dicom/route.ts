import { API_ROUTES } from "@health-mcp/shared";

import { apiUrl } from "@/lib/api-client";

const jsonError = (status: number, error: string, message: string) =>
  Response.json({ statusCode: status, error, message }, { status });

/**
 * Forwards a DICOM zip upload to the api, streaming the body so a large CD
 * export is never held in memory here. The api checks the type and size.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!request.body) return jsonError(400, "Bad Request", "Choose a zip file to upload");

  const length = request.headers.get("content-length");
  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl()}${API_ROUTES.dicomUpload(id)}`, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/zip",
        ...(length && { "Content-Length": length }),
      },
      body: request.body,
      // Required by fetch to send a streamed body.
      duplex: "half",
      cache: "no-store",
      signal: request.signal,
    } as RequestInit);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("DICOM upload could not reach the api", error);
    return jsonError(503, "Service Unavailable", "The api is not reachable");
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
