import { describe, expect, it } from "vitest";

import { splitText } from "../src/index.js";

/** "Sentence 1 is here. Sentence 2 is here. …", each 20 characters with its space. */
const numbered = (count: number, from = 1) =>
  Array.from(
    { length: count },
    (_, i) => `Sentence ${String(from + i).padStart(2, "0")} here.`,
  ).join(" ");

describe("splitText", () => {
  it("returns nothing for empty text and one chunk for short text", () => {
    expect(splitText("")).toEqual([]);
    expect(splitText("  \n\n ")).toEqual([]);
    expect(splitText("  Mild   headache\nin the morning. ")).toEqual([
      "Mild headache in the morning.",
    ]);
  });

  it("keeps paragraphs together and separated by a blank line", () => {
    const text = "Findings: postoperative changes.\n\n\nImpression: stable.";

    expect(splitText(text)).toEqual(["Findings: postoperative changes.\n\nImpression: stable."]);
  });

  it("starts a new chunk at a paragraph boundary when the next paragraph does not fit", () => {
    const first = "a".repeat(30);
    const second = "b".repeat(30);

    expect(splitText(`${first}\n\n${second}`, { maxChars: 50, overlapChars: 0 })).toEqual([
      first,
      second,
    ]);
  });

  it("splits a long paragraph at sentence boundaries, within the limit", () => {
    const chunks = splitText(numbered(10), { maxChars: 60, overlapChars: 0 });

    expect(chunks).toEqual([numbered(3, 1), numbered(3, 4), numbered(3, 7), numbered(1, 10)]);
    expect(chunks.every((chunk) => chunk.length <= 60)).toBe(true);
  });

  it("repeats the last whole sentences that fit in the overlap", () => {
    const chunks = splitText(numbered(6), { maxChars: 60, overlapChars: 20 });

    // Each chunk after the first starts with the previous chunk's last sentence.
    expect(chunks[0]).toBe(numbered(3, 1));
    expect(chunks[1]).toBe(numbered(3, 3));
    expect(chunks[2]).toBe(numbered(2, 5));
  });

  it("loses no sentence", () => {
    const text = numbered(40);

    const joined = splitText(text, { maxChars: 120, overlapChars: 40 }).join(" ");

    for (let n = 1; n <= 40; n++) expect(joined).toContain(numbered(1, n));
  });

  it("splits a sentence longer than the limit at spaces, and a single huge word anywhere", () => {
    expect(splitText("word ".repeat(30).trim(), { maxChars: 20, overlapChars: 0 })).toEqual(
      Array.from({ length: 8 }, (_, i) => (i < 7 ? "word word word word" : "word word")),
    );
    expect(splitText("x".repeat(45), { maxChars: 20, overlapChars: 0 })).toEqual([
      "x".repeat(20),
      "x".repeat(20),
      "x".repeat(5),
    ]);
  });
});
