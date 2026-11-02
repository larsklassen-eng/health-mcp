import { describe, expect, it } from "vitest";

import { checkPassword, PASSWORD_MIN_SCORE } from "../src/password.js";

const ana = { email: "ana.example@example.com", firstName: "Ana", lastName: "Example" };

describe("checkPassword", () => {
  it.each(["my dog likes blue trains", "violet-tram-orbit-91", "Kq3!vZ8@pLw2"])(
    "accepts %j",
    (password) => {
      const check = checkPassword(password, ana);
      expect(check).toMatchObject({ ok: true });
      expect(check.score).toBeGreaterThanOrEqual(PASSWORD_MIN_SCORE);
      expect(check.problem).toBeUndefined();
    },
  );

  it("needs 12 to 200 characters", () => {
    expect(checkPassword("Kq3!vZ8@pLw")).toMatchObject({
      ok: false,
      problem: "Use at least 12 characters.",
    });
    expect(checkPassword("x".repeat(201))).toMatchObject({
      ok: false,
      problem: "Use at most 200 characters.",
    });
  });

  it("refuses common and guessable passwords, with zxcvbn's reason", () => {
    const check = checkPassword("password1234");

    expect(check.ok).toBe(false);
    expect(check.score).toBeLessThan(PASSWORD_MIN_SCORE);
    expect(check.problem).toBe("This is similar to a commonly used password.");
    expect(checkPassword("aaaaaaaaaaaaaaaa").ok).toBe(false);
  });

  it.each([
    ["the last name", "Example rocks 2026!"],
    ["the email address", "ana.example@example.com"],
    ["the part before the @", "my ANA.EXAMPLE secret"],
    ["a short first name, on its own", "Ana2026 likes trains"],
  ])("refuses %s in any case", (_part, password) => {
    expect(checkPassword(password, ana)).toMatchObject({
      ok: false,
      problem: "Leave your name and email address out of the password.",
    });
  });

  it("allows a short name inside another word", () => {
    expect(checkPassword("banana bread on tuesdays", ana).ok).toBe(true);
  });
});
