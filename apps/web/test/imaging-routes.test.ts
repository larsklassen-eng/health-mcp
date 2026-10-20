// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/patients/[id]/imaging/dicom/route";
import { proxyImage } from "@/lib/image-proxy";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());

describe("POST /patients/[id]/imaging/dicom", () => {
  const upload = () =>
    new Request("http://web.test/patients/p1/imaging/dicom", {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: "PK-zip-bytes",
    });

  it("streams the zip to the api and returns its answer", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ studies: [], skippedFiles: 0, unsupportedImages: 0 }, { status: 201 }),
    );

    const response = await POST(upload(), { params: Promise.resolve({ id: "a/b" }) });

    expect(response.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/patients/a%2Fb/imaging/dicom");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/zip" });
    expect(init?.body).toBeInstanceOf(ReadableStream);
    expect(await response.json()).toMatchObject({ studies: [] });
  });

  it("passes on api errors and reports an unreachable api", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: "too big" }, { status: 413 }));
    expect((await POST(upload(), { params: Promise.resolve({ id: "p1" }) })).status).toBe(413);

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await POST(upload(), { params: Promise.resolve({ id: "p1" }) })).status).toBe(503);
  });
});

describe("proxyImage", () => {
  const params = (position: string) => ({ id: "p1", studyId: "s1", seriesId: "r1", position });

  it("forwards the PNG with its cache header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Cache-Control": "private, max-age=31536000, immutable" },
      }),
    );

    const response = await proxyImage(params("7"));

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/patients/p1/imaging/s1/series/r1/images/7",
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("returns 404 for a position that is not a number, and passes on api errors", async () => {
    expect((await proxyImage(params("../../x"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await proxyImage(params("99"))).status).toBe(404);
  });
});
