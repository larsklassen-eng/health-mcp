import { API_ROUTES } from "@health-mcp/shared";

import { apiUrl } from "@/lib/api-client";
import { sessionHeaders } from "@/lib/session";

const jsonError = (status: number, error: string, message: string) =>
  Response.json({ statusCode: status, error, message }, { status });

const passOn = async (response: Response) =>
  new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
  });

/**
 * Forwards a DICOM zip upload to the api, streaming the body so a large CD
 * export is never held in memory here. The api checks the type and size.
 *
 * The proxy does not run for this route (see proxy.ts), so it first asks the
 * api for the patient: that answers 401 without a valid session and 404 for
 * another doctor's patient. Refused while streaming, the upload would fail
 * as a broken connection instead.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!request.body) return jsonError(400, "Bad Request", "Choose a zip file to upload");

  const length = request.headers.get("content-length");
  const auth = await sessionHeaders();
  let upstream: Response;
  try {
    const patient = await fetch(`${apiUrl()}${API_ROUTES.patient(id)}`, {
      headers: auth,
      cache: "no-store",
      signal: request.signal,
    });
    if (!patient.ok) return await passOn(patient);
    upstream = await fetch(`${apiUrl()}${API_ROUTES.dicomUpload(id)}`, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/zip",
        ...(length && { "Content-Length": length }),
        ...auth,
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

  return passOn(upstream);
}
