// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/patients/[id]/chat/stream/route";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());

const SSE = 'data: {"type":"message_start","messageId":"m1"}\n\n';
const params = (id = "p1") => ({ params: Promise.resolve({ id }) });
const post = (body: string, init: RequestInit = {}) =>
  new Request("http://web.test/patients/p1/chat/stream", { method: "POST", body, ...init });

describe("POST /patients/[id]/chat/stream", () => {
  it("forwards the message to the api and streams its events back unchanged", async () => {
    fetchMock.mockResolvedValueOnce(new Response(SSE, { headers: { "Content-Type": "text/event-stream" } }));
    const request = post(JSON.stringify({ message: "  Any abnormal labs?  " }));

    const response = await POST(request, params("a/b"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toBe(SSE);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/patients/a%2Fb/chat");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ message: "Any abnormal labs?" });
    expect(init?.signal).toBe(request.signal); // closing the browser tab stops the api request
  });

  it.each([
    ["not JSON", "hello"],
    ["an empty message", JSON.stringify({ message: "   " })],
    ["a message over 8000 characters", JSON.stringify({ message: "x".repeat(8001) })],
  ])("returns 400 without calling the api for %s", async (_, body) => {
    const response = await POST(post(body), params());

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 413 for a very large body", async () => {
    const response = await POST(post(JSON.stringify({ message: "x".repeat(70_000) })), params());

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the api's JSON errors through", async () => {
    const error = { statusCode: 404, error: "Not Found", message: "Patient p1 not found" };
    fetchMock.mockResolvedValueOnce(Response.json(error, { status: 404 }));

    const response = await POST(post(JSON.stringify({ message: "Hi" })), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(error);
  });

  it("returns 503 when the api cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await POST(post(JSON.stringify({ message: "Hi" })), params());

    expect(response.status).toBe(503);
  });
});
