import { API_ROUTES } from "@health-mcp/shared";

import { apiUrl } from "@/lib/api-client";
import { sessionHeaders } from "@/lib/session";

export interface ImageParams {
  id: string;
  studyId: string;
  seriesId: string;
  position: string;
}

/** Forwards one PNG slice from the api, so the browser never needs the api's URL. */
export async function proxyImage({ id, studyId, seriesId, position }: ImageParams) {
  const index = Number(position);
  if (!Number.isInteger(index) || index < 0) return new Response(null, { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl()}${API_ROUTES.imagingImage(id, studyId, seriesId, index)}`, {
      cache: "no-store",
      headers: await sessionHeaders(),
    });
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) return new Response(null, { status: upstream.status });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": upstream.headers.get("cache-control") ?? "private, max-age=3600",
    },
  });
}
