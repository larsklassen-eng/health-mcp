// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, ApiUnavailableError } from "@/lib/api-client";

const { decideToolCall } = vi.hoisted(() => ({ decideToolCall: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { decideToolCall },
}));

const { decideToolCallAction } = await import("@/app/patients/[id]/chat/actions");

beforeEach(() => vi.clearAllMocks());

describe("decideToolCallAction", () => {
  it("returns the updated tool call", async () => {
    const toolCall = {
      id: "t1",
      name: "log_symptom",
      input: {},
      isError: false,
      confirmation: "confirmed",
    };
    decideToolCall.mockResolvedValueOnce(toolCall);

    expect(await decideToolCallAction("p1", "t1", "confirm")).toEqual({ toolCall });
    expect(decideToolCall).toHaveBeenCalledWith("p1", "t1", "confirm");
  });

  it("rejects invalid arguments without calling the api", async () => {
    expect(await decideToolCallAction("p1", "t1", "delete-everything")).toEqual({
      error: "Invalid request.",
    });
    expect(await decideToolCallAction("", "t1", "confirm")).toEqual({ error: "Invalid request." });
    expect(decideToolCall).not.toHaveBeenCalled();
  });

  it("passes on the api's explanation", async () => {
    decideToolCall.mockRejectedValueOnce(
      new ApiRequestError(409, {
        statusCode: 409,
        error: "Conflict",
        message: "This entry was already saved or discarded",
      }),
    );

    expect(await decideToolCallAction("p1", "t1", "confirm")).toEqual({
      error: "This entry was already saved or discarded",
    });
  });

  it("explains when the api is not reachable", async () => {
    decideToolCall.mockRejectedValueOnce(new ApiUnavailableError(new Error("ECONNREFUSED")));

    const result = await decideToolCallAction("p1", "t1", "reject");

    expect(result).toEqual({ error: expect.stringContaining("Could not reach the API") });
  });
});
