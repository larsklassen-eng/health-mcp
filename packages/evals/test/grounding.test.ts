import { describe, expect, it } from "vitest";

import { numbersIn, sourceText, ungroundedNumbers } from "../src/index.js";

describe("numbersIn", () => {
  it("normalizes thousands separators, trailing zeros and leading zeros", () => {
    expect(numbersIn("1,200 cells, 12.90 g/dL, on 2025-10-07; values 3,4")).toEqual([
      "1200",
      "12.9",
      "2025",
      "10",
      "7",
      "3",
      "4",
    ]);
  });
});

describe("ungroundedNumbers", () => {
  const sources = [sourceText({ value: 12.9, collectedAt: "2025-10-28T07:00:00Z" }), "1,500"];

  it("accepts numbers found in a source, however they are written", () => {
    expect(ungroundedNumbers("12.90 g/dL on October 28, 2025; ANC 1500", sources)).toEqual([]);
  });

  it("ignores single-digit integers such as counts and list numbers", () => {
    expect(ungroundedNumbers("1. Three results, 2 of them low, severity 4", sources)).toEqual([]);
  });

  it("lists each other number once, with the text around its first mention", () => {
    expect(ungroundedNumbers("Platelets 95, and again 95. Hemoglobin 11.2.", sources)).toEqual([
      { value: "95", context: "Platelets 95, and again 95. Hemoglobin 11.2." },
      { value: "11.2", context: "Platelets 95, and again 95. Hemoglobin 11.2." },
    ]);
  });

  it("skips the numbers a case allows", () => {
    expect(ungroundedNumbers("Below 100 is grade 1.", sources, ["100"])).toEqual([]);
  });

  it("shortens long context", () => {
    const [found] = ungroundedNumbers(`${"a ".repeat(60)}value 42 ${"b ".repeat(60)}`, []);
    expect(found?.context).toMatch(/^….{0,50}42.{0,50}…$/);
  });
});
