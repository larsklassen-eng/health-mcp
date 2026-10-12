import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LlmError, type LlmStreamEvent } from "../src/llm/llm-client.js";
import { OpenRouterLlmClient } from "../src/llm/openrouter-llm-client.js";
import { collect } from "./fakes/fake-llm-client.js";

/*
 * A local stand-in for the OpenRouter API, speaking its wire format (SSE chunks
 * with snake_case JSON), so the real SDK request/response handling is exercised
 * without network access or an API key.
 */

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let requests: RecordedRequest[];
let respond: (res: ServerResponse) => void;

beforeEach(async () => {
  requests = [];
  respond = (res) => sse(res, [chunk({ content: "ok" }, "stop")]);
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const part of req) raw += part;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: JSON.parse(raw || "{}") });
    respond(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const createClient = ({ apiKey = "sk-or-test", zeroDataRetention = true }: { apiKey?: string | undefined; zeroDataRetention?: boolean } = {}) =>
  new OpenRouterLlmClient({
    apiKey,
    model: "anthropic/claude-opus-5.5",
    maxTokens: 4000,
    zeroDataRetention,
    serverURL: baseUrl,
    retries: false,
  });

function chunk(delta: Record<string, unknown>, finishReason: string | null = null, extra: Record<string, unknown> = {}) {
  return {
    id: "gen-1",
    object: "chat.completion.chunk",
    created: 1_760_000_000,
    model: "anthropic/claude-opus-5.5",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  };
}

function sse(res: ServerResponse, chunks: unknown[], { end = true } = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const item of chunks) res.write(`data: ${JSON.stringify(item)}\n\n`);
  if (end) {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

const usageChunk = { ...chunk({}), choices: [], usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 } };

describe("OpenRouterLlmClient", () => {
  it("streams text deltas, then finishes with usage", async () => {
    respond = (res) =>
      sse(res, [chunk({ role: "assistant", content: "Hemo" }), chunk({ content: "globin is low." }), chunk({}, "stop"), usageChunk]);

    const events = await collect(createClient().stream({ messages: [{ role: "user", content: "Labs?" }] }));

    expect(events).toEqual<LlmStreamEvent[]>([
      { type: "text_delta", delta: "Hemo" },
      { type: "text_delta", delta: "globin is low." },
      { type: "finish", reason: "stop", usage: { inputTokens: 120, outputTokens: 8 } },
    ]);
  });

  it("sends the model, limits, messages and tools in OpenRouter's format", async () => {
    await collect(
      createClient().stream({
        messages: [
          { role: "system", content: "You are a clinical assistant." },
          { role: "user", content: "Any abnormal labs?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "get_lab_results", arguments: '{"limit":5}' }],
          },
          { role: "tool", toolCallId: "call_1", content: '[{"testName":"Hemoglobin"}]' },
        ],
        tools: [
          {
            name: "get_lab_results",
            description: "Get lab results.",
            parameters: { type: "object", properties: { limit: { type: "integer" } } },
          },
        ],
      }),
    );

    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/api/v1/chat/completions");
    expect(request?.authorization).toBe("Bearer sk-or-test");
    expect(request?.body).toMatchObject({
      model: "anthropic/claude-opus-5.5",
      max_tokens: 4000,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "You are a clinical assistant." },
        { role: "user", content: "Any abnormal labs?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "get_lab_results", arguments: '{"limit":5}' } }],
        },
        { role: "tool", tool_call_id: "call_1", content: '[{"testName":"Hemoglobin"}]' },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_lab_results",
            description: "Get lab results.",
            parameters: { type: "object", properties: { limit: { type: "integer" } } },
          },
        },
      ],
    });
  });

  it("excludes data-collecting providers and requires zero data retention by default", async () => {
    await collect(createClient().stream({ messages: [{ role: "user", content: "Hi" }] }));
    expect(requests[0]?.body.provider).toEqual({ data_collection: "deny", zdr: true });
  });

  it("still excludes data-collecting providers when zero data retention is turned off", async () => {
    await collect(createClient({ zeroDataRetention: false }).stream({ messages: [{ role: "user", content: "Hi" }] }));
    expect(requests[0]?.body.provider).toEqual({ data_collection: "deny" });
  });

  it.each([
    [true, true],
    [false, false],
  ])("explains the data policy on a 404 only when ZDR is on (zdr=%s)", async (zeroDataRetention, mentionsZdr) => {
    respond = (res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"error":{"code":404,"message":"No endpoints found matching your data policy"}}');
    };

    const error = await collect(createClient({ zeroDataRetention }).stream({ messages: [{ role: "user", content: "Hi" }] })).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({ status: 404 });
    expect((error as LlmError).message.includes("OPENROUTER_ZDR")).toBe(mentionsZdr);
  });

  it("omits tools when there are none", async () => {
    await collect(createClient().stream({ messages: [{ role: "user", content: "Hi" }], tools: [] }));
    expect(requests[0]?.body).not.toHaveProperty("tools");
  });

  it("reassembles parallel tool calls streamed in interleaved fragments", async () => {
    const fragment = (index: number, fields: Record<string, unknown>) => chunk({ tool_calls: [{ index, ...fields }] });
    respond = (res) =>
      sse(res, [
        chunk({ content: "Checking." }),
        fragment(0, { id: "call_a", type: "function", function: { name: "get_lab_results", arguments: "" } }),
        fragment(1, { id: "call_b", type: "function", function: { name: "get_medications", arguments: '{"sta' } }),
        fragment(0, { function: { arguments: '{"limit"' } }),
        fragment(1, { function: { arguments: 'tus":"all"}' } }),
        fragment(0, { function: { arguments: ":5}" } }),
        chunk({}, "tool_calls"),
      ]);

    const events = await collect(createClient().stream({ messages: [{ role: "user", content: "Labs and meds?" }] }));

    expect(events).toEqual<LlmStreamEvent[]>([
      { type: "text_delta", delta: "Checking." },
      { type: "tool_call", call: { id: "call_a", name: "get_lab_results", arguments: '{"limit":5}' } },
      { type: "tool_call", call: { id: "call_b", name: "get_medications", arguments: '{"status":"all"}' } },
      { type: "finish", reason: "tool_calls" },
    ]);
  });

  it("fails clearly without an API key and makes no request", async () => {
    const client = new OpenRouterLlmClient({ apiKey: undefined, model: "m", maxTokens: 4000, zeroDataRetention: true, serverURL: baseUrl });
    await expect(collect(client.stream({ messages: [] }))).rejects.toThrow("OPENROUTER_API_KEY is not set");
    expect(requests).toHaveLength(0);
  });

  it.each([
    [401, '{"error":{"code":401,"message":"No auth credentials found"}}'],
    [402, '{"error":{"code":402,"message":"Insufficient credits"}}'],
    [500, '{"error":{"code":500,"message":"Internal error"}}'],
  ])("turns an HTTP %i into an LlmError with the status", async (status, body) => {
    respond = (res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    };

    const error = await collect(createClient().stream({ messages: [{ role: "user", content: "Hi" }] })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(status);
    expect((error as LlmError).aborted).toBe(false);
  });

  it("turns an error reported mid-stream into an LlmError", async () => {
    respond = (res) =>
      sse(res, [chunk({ content: "Part" }), { ...chunk({}, "error"), error: { code: 502, message: "Provider disconnected" } }]);

    const events: LlmStreamEvent[] = [];
    const error = await (async () => {
      for await (const event of createClient().stream({ messages: [{ role: "user", content: "Hi" }] })) events.push(event);
    })().catch((e: unknown) => e);

    expect(events).toEqual([{ type: "text_delta", delta: "Part" }]);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ status: 502, message: "Provider disconnected" });
  });

  it("stops with an aborted LlmError when the caller aborts", async () => {
    respond = (res) => sse(res, [chunk({ content: "Still thinking" })], { end: false }); // server never finishes
    const controller = new AbortController();

    const error = await (async () => {
      for await (const event of createClient().stream({ messages: [{ role: "user", content: "Hi" }] }, controller.signal)) {
        if (event.type === "text_delta") controller.abort();
      }
    })().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).aborted).toBe(true);
  });
});
