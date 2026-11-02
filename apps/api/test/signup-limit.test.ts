import { describe, expect, it } from "vitest";

import { SignupLimit } from "../src/auth/signup-limit.js";

describe("SignupLimit", () => {
  it("allows the set number of accounts per hour, then until the oldest is an hour old", () => {
    const limit = new SignupLimit(2);
    const start = 1_000_000;

    expect(limit.retryAfter(start)).toBe(0);
    limit.record(start);
    limit.record(start + 10 * 60_000);

    expect(limit.retryAfter(start + 20 * 60_000)).toBe(40 * 60_000);
    expect(limit.retryAfter(start + 60 * 60_000 + 1)).toBe(0);
  });
});
