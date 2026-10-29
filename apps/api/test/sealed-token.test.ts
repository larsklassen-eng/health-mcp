import { describe, expect, it } from "vitest";

import { TokenSealer } from "../src/auth/sealed-token.js";

const sealer = new TokenSealer("a".repeat(32));
const now = Date.parse("2026-10-29T12:00:00Z");

describe("TokenSealer", () => {
  it("returns the payload of a valid token, with its expiry", () => {
    const token = sealer.seal("session", { email: "ana@example.com" }, 60, now);

    expect(token).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(token).not.toContain("ana");
    expect(sealer.open("session", token, now)).toEqual({
      email: "ana@example.com",
      exp: now + 60_000,
    });
  });

  it("rejects an expired token", () => {
    const token = sealer.seal("session", {}, 60, now);
    expect(sealer.open("session", token, now + 60_000)).toBeUndefined();
  });

  it("rejects a token for another purpose, or sealed with another secret", () => {
    const token = sealer.seal("login", { state: "x" }, 60, now);
    expect(sealer.open("session", token, now)).toBeUndefined();
    expect(new TokenSealer("b".repeat(32)).open("login", token, now)).toBeUndefined();
  });

  it("rejects tampered and malformed tokens", () => {
    const token = sealer.seal("session", { email: "ana@example.com" }, 60, now);
    const parts = token.split(".");
    const flipped = parts[2]!.startsWith("A") ? `B${parts[2]!.slice(1)}` : `A${parts[2]!.slice(1)}`;

    for (const bad of [
      [parts[0], parts[1], flipped, parts[3]].join("."),
      `${token}.extra`,
      token.replace("v1.", "v2."),
      "",
      "not a token",
    ])
      expect(sealer.open("session", bad, now)).toBeUndefined();
  });
});
