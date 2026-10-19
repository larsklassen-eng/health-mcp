import type { ChatStreamEvent } from "@health-mcp/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/app/patients/[id]/chat/chat-panel";

const { decideToolCallAction } = vi.hoisted(() => ({ decideToolCallAction: vi.fn() }));
vi.mock("@/app/patients/[id]/chat/actions", () => ({ decideToolCallAction }));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());

const sse = (event: ChatStreamEvent) =>
  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

/**
 * A streamed response the test controls: push events, then close. It errors
 * like fetch does when aborted.
 */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  fetchMock.mockImplementationOnce(async (_url, init) => {
    init?.signal?.addEventListener("abort", () =>
      controller.error(new DOMException("Aborted", "AbortError")),
    );
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  });
  return {
    push: (event: ChatStreamEvent) => controller.enqueue(sse(event)),
    close: () => controller.close(),
  };
}

const respondWith = (...events: ChatStreamEvent[]) => {
  const stream = controlledStream();
  events.forEach(stream.push);
  stream.close();
};

const history = [
  {
    id: "m1",
    patientId: "p1",
    role: "user" as const,
    content: "Earlier question",
    toolCalls: [],
    createdAt: "2026-10-01T10:00:00.000Z",
  },
];

const setup = () => {
  render(<ChatPanel patientId="p1" initialMessages={history} />);
  return { user: userEvent.setup(), box: screen.getByRole("textbox", { name: "Message" }) };
};
const contents = () =>
  screen
    .getAllByRole("listitem")
    .filter((item) => item.matches(".chat-message"))
    .map((item) => item.querySelector(".chat-content")?.textContent);

describe("ChatPanel", () => {
  it("sends a message and shows the streamed answer", async () => {
    respondWith(
      { type: "message_start", messageId: "a1" },
      { type: "text_delta", delta: "Hemoglobin " },
      { type: "text_delta", delta: "is low." },
      { type: "message_end", messageId: "a1" },
    );
    const { user, box } = setup();

    await user.type(box, "Any abnormal labs?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(contents()).toEqual(["Earlier question", "Any abnormal labs?", "Hemoglobin is low."]),
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/patients/p1/chat/stream");
    expect(JSON.parse(init?.body as string)).toEqual({ message: "Any abnormal labs?" });
    expect(box).toHaveValue("");
    expect(box).toBeEnabled();
  });

  it("shows the answer while it streams and locks the message box", async () => {
    const stream = controlledStream();
    const { user, box } = setup();

    await user.type(box, "Hi{Enter}");
    stream.push({ type: "message_start", messageId: "a1" });
    stream.push({ type: "text_delta", delta: "Partial" });

    await waitFor(() => expect(contents().at(-1)).toBe("Partial"));
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    stream.push({ type: "message_end", messageId: "a1" });
    stream.close();
    await waitFor(() => expect(box).toBeEnabled());
    expect(contents().at(-1)).toBe("Partial");
  });

  it("adds a new line with Shift+Enter instead of sending", async () => {
    const { user, box } = setup();

    await user.type(box, "Line one{Shift>}{Enter}{/Shift}Line two");

    expect(box).toHaveValue("Line one\nLine two");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send an empty message", async () => {
    const { user, box } = setup();

    await user.type(box, "   ");

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(box, "{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops the answer, drops the partial text and keeps the question", async () => {
    const stream = controlledStream();
    const { user, box } = setup();

    await user.type(box, "Hi{Enter}");
    stream.push({ type: "text_delta", delta: "Partial" });
    await waitFor(() => expect(contents().at(-1)).toBe("Partial"));
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Answer stopped"));
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(contents()).toEqual(["Earlier question", "Hi"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows tool calls while they run and keeps them with the answer", async () => {
    const stream = controlledStream();
    const { user, box } = setup();

    await user.type(box, "Hemoglobin?{Enter}");
    stream.push({ type: "message_start", messageId: "a1" });
    stream.push({
      type: "tool_call_start",
      toolCallId: "t1",
      name: "get_lab_results",
      input: { test_name: "Hemoglobin" },
    });

    const card = await screen.findByText("Lab results");
    expect(card.closest(".tool-call")).toHaveTextContent("Running…");

    stream.push({
      type: "tool_call_result",
      toolCallId: "t1",
      output: { results: [] },
      isError: false,
    });
    await waitFor(() =>
      expect(screen.getByText("Lab results").closest(".tool-call")).toHaveTextContent("Done"),
    );

    stream.push({ type: "text_delta", delta: "No results." });
    stream.push({ type: "message_end", messageId: "a1" });
    stream.close();
    await waitFor(() => expect(box).toBeEnabled());
    const answer = screen
      .getAllByRole("listitem")
      .filter((item) => item.matches(".chat-message"))
      .at(-1)!;
    expect(answer).toHaveTextContent("No results.");
    expect(answer.querySelector(".tool-call.done")).toHaveTextContent("test name: Hemoglobin");
  });

  it("lets the clinician save a proposed entry once the answer is done", async () => {
    const stream = controlledStream();
    const call = { id: "t1", name: "log_symptom", input: { name: "Headache", severity: 4 } };
    decideToolCallAction.mockResolvedValueOnce({
      toolCall: { ...call, output: { symptom: {} }, isError: false, confirmation: "confirmed" },
    });
    const { user, box } = setup();

    await user.type(box, "Log a headache{Enter}");
    stream.push({ type: "message_start", messageId: "a1" });
    stream.push({ type: "tool_call_start", toolCallId: "t1", name: call.name, input: call.input });
    stream.push({
      type: "tool_call_result",
      toolCallId: "t1",
      output: "Not saved yet.",
      isError: false,
      confirmation: "pending",
    });
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // the answer is not saved yet

    stream.push({ type: "text_delta", delta: "Please confirm." });
    stream.push({ type: "message_end", messageId: "a1" });
    stream.close();
    // The saved answer replaces the draft, so look the button up again.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(decideToolCallAction).toHaveBeenCalledWith("p1", "t1", "confirm");
    await waitFor(() =>
      expect(screen.getByText("Log symptom").closest(".tool-call")).toHaveTextContent("Saved"),
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows the api's error event and keeps the question", async () => {
    respondWith(
      { type: "message_start", messageId: "a1" },
      { type: "error", message: "The assistant could not answer. Please try again." },
    );
    const { user, box } = setup();

    await user.type(box, "Hi{Enter}");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("The assistant could not answer"),
    );
    expect(contents()).toEqual(["Earlier question", "Hi"]);
  });

  it("reports a stream that ends without an answer", async () => {
    respondWith({ type: "message_start", messageId: "a1" }, { type: "text_delta", delta: "Cut" });
    const { user, box } = setup();

    await user.type(box, "Hi{Enter}");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be sent"));
    expect(contents()).toEqual(["Earlier question", "Hi"]);
  });

  it.each([
    [404, "This patient no longer exists."],
    [503, "The api is not reachable"],
    [500, "The message could not be sent"],
  ])("explains a %i from the proxy", async (status, text) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ statusCode: status, error: "x", message: "x" }, { status }),
    );
    const { user, box } = setup();

    await user.type(box, "Hi{Enter}");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(text));
  });

  it("clears the previous error when sending again", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    respondWith(
      { type: "message_start", messageId: "a1" },
      { type: "text_delta", delta: "Ok" },
      { type: "message_end", messageId: "a1" },
    );
    const { user, box } = setup();

    await user.type(box, "Hi{Enter}");
    await screen.findByRole("alert");
    await user.type(box, "Again{Enter}");

    await waitFor(() => expect(contents().at(-1)).toBe("Ok"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
