import { type ImageParams, proxyImage } from "@/lib/image-proxy";

/** One PNG slice of a study's series (see `proxyImage`). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<ImageParams> },
): Promise<Response> {
  return proxyImage(await params);
}
