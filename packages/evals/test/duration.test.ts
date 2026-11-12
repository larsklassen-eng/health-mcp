import { describe, expect, it } from "vitest";

import { daysBetween, statedDuration, utcToday } from "../src/index.js";

describe("daysBetween", () => {
  it("counts whole days, across months and years", () => {
    expect(daysBetween("2026-09-23", "2026-10-06")).toBe(13);
    expect(daysBetween("2025-10-28", "2026-11-12")).toBe(380);
  });
});

describe("utcToday", () => {
  it("is the UTC date, as the api gives it to the model", () => {
    expect(utcToday(new Date("2026-11-12T23:30:00-03:00"))).toBe("2026-11-13");
  });
});

describe("statedDuration", () => {
  // 380 days: 54.3 weeks, 12.5 months, 1.04 years.
  const since = (answer: string) => statedDuration(answer, "2025-10-28", "2026-11-12");

  it.each([
    "That was 380 days ago.",
    "That was 381 days ago, counting the day itself.",
    "About 54 weeks ago.",
    "about 12.5 months ago",
    "Roughly 13 months ago.",
    "Just over a year ago.",
    "One year ago, almost to the day.",
    "a 1-year follow-up",
  ])("accepts %j", (answer) => {
    expect(since(answer)).toBeDefined();
  });

  it.each([
    "That was 365 days ago.",
    "About 50 weeks ago.",
    "Ten months ago.",
    "Two years ago.",
    "His surgery was on 2025-10-28.",
  ])("rejects %j", (answer) => {
    expect(since(answer)).toBeUndefined();
  });

  it("returns the duration as written, for the report", () => {
    expect(since("Surgery was 2025-10-28, about 12.5 months ago.")).toBe("12.5 months");
  });

  it("checks a gap between two dates in the record", () => {
    expect(statedDuration("13 days after surgery", "2026-09-23", "2026-10-06")).toBe("13 days");
    expect(statedDuration("two weeks later", "2026-09-23", "2026-10-06")).toBe("two weeks");
    expect(statedDuration("3 weeks later", "2026-09-23", "2026-10-06")).toBeUndefined();
  });
});
