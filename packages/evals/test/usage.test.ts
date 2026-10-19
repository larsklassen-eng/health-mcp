import { describe, expect, it } from "vitest";

import { formatUsage, sumUsage } from "../src/index.js";

describe("sumUsage", () => {
  it("adds up answers, counting cached tokens and cost only where reported", () => {
    expect(
      sumUsage([
        { modelCalls: 2, inputTokens: 1000, outputTokens: 50, costUsd: 0.01 },
        undefined,
        {
          modelCalls: 1,
          inputTokens: 500,
          outputTokens: 20,
          cachedInputTokens: 300,
          costUsd: 0.02,
        },
      ]),
    ).toEqual({
      modelCalls: 3,
      inputTokens: 1500,
      outputTokens: 70,
      cachedInputTokens: 300,
      costUsd: expect.closeTo(0.03, 10),
    });
  });

  it("leaves out cost when no answer reported it", () => {
    expect(sumUsage([{ modelCalls: 1, inputTokens: 10, outputTokens: 1 }])).toEqual({
      modelCalls: 1,
      inputTokens: 10,
      outputTokens: 1,
    });
  });
});

describe("formatUsage", () => {
  it("shows calls, tokens and cost", () => {
    expect(
      formatUsage({
        modelCalls: 3,
        inputTokens: 12_345,
        outputTokens: 678,
        cachedInputTokens: 8_000,
        costUsd: 0.04213,
      }),
    ).toBe("3 model calls, 12,345 in (8,000 cached) / 678 out, $0.0421");
  });

  it("says what is missing", () => {
    expect(formatUsage({ modelCalls: 1, inputTokens: 10, outputTokens: 2 })).toBe(
      "1 model call, 10 in / 2 out, cost not reported",
    );
    expect(formatUsage(undefined)).toBe("usage not reported");
  });
});
