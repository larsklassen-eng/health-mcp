import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import { startTracing } from "../src/start-tracing.js";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  trace.disable();
});

/** A stand-in for Phoenix's collector that records each request. */
async function collector(status = 200) {
  const requests: { url: string | undefined; headers: IncomingHttpHeaders }[] = [];
  server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    req.resume();
    req.on("end", () => res.writeHead(status).end());
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}/`, requests };
}

const sendOneSpan = () => trace.getTracer("test").startActiveSpan("rag.search", (s) => s.end());

describe("startTracing", () => {
  it("sends spans to <endpoint>/v1/traces with the API key", async () => {
    const { endpoint, requests } = await collector();
    const tracing = startTracing({ endpoint, serviceName: "test", apiKey: "phoenix-key" });

    sendOneSpan();
    await tracing.shutdown();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("/v1/traces");
    expect(requests[0]!.headers.authorization).toBe("Bearer phoenix-key");
    expect(requests[0]!.headers["content-type"]).toBe("application/x-protobuf");
  });

  it("sends no Authorization header without a key", async () => {
    const { endpoint, requests } = await collector();
    const tracing = startTracing({ endpoint, serviceName: "test" });

    sendOneSpan();
    await tracing.shutdown();

    expect(requests[0]!.headers.authorization).toBeUndefined();
  });
});
