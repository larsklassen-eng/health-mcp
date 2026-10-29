import { describe, expect, it } from "vitest";

import { hashPassword, UNKNOWN_USER_HASH, verifyPassword } from "../src/auth/password.js";
import { LoginThrottle } from "../src/auth/login-throttle.js";

describe("password hashing", () => {
  it("verifies the right password and refuses others", async () => {
    const hash = await hashPassword("correct horse battery");

    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password!")).not.toBe(await hashPassword("same password!"));
  });

  it("treats differently encoded but identical characters as the same password", async () => {
    const hash = await hashPassword("café au lait 1"); // é as one code point
    expect(await verifyPassword("café au lait 1", hash)).toBe(true); // e + accent
  });

  it("refuses every password against the unknown-user hash and malformed hashes", async () => {
    expect(await verifyPassword("anything", UNKNOWN_USER_HASH)).toBe(false);
    for (const hash of ["", "plain", "bcrypt$1$2$3$a$b", "scrypt$x$8$1$AAAA$AAAA"])
      expect(await verifyPassword("anything", hash)).toBe(false);
  });
});

describe("LoginThrottle", () => {
  const now = 1_000_000;

  it("blocks a key after 5 failures within 15 minutes, until the oldest one ages out", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 4; i++) throttle.fail("ana", now + i * 60_000);
    expect(throttle.retryAfter("ana", now + 4 * 60_000)).toBe(0);

    throttle.fail("ana", now + 4 * 60_000);

    expect(throttle.retryAfter("ana", now + 5 * 60_000)).toBe(10 * 60_000);
    expect(throttle.retryAfter("ben", now + 5 * 60_000)).toBe(0);
    expect(throttle.retryAfter("ana", now + 15 * 60_000)).toBe(0);
  });

  it("forgets failures after a successful sign-in", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 5; i++) throttle.fail("ana", now);

    throttle.succeed("ana");

    expect(throttle.retryAfter("ana", now)).toBe(0);
  });
});
