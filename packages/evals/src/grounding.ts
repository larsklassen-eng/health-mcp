/*
 * A check that costs no model call: every number the answer states should
 * appear somewhere the model could have read it (the profile in the system
 * prompt, the clinician's message, or a tool's input or output). A number found
 * nowhere is either invented (a made-up lab value) or legitimate: general
 * medical knowledge ("grade 1 is ANC ≥ 1.5") or derived ("an average of 3.2").
 * Measured on 60 saved answers, every flagged number was of the legitimate kind,
 * so these are warnings to review, not failures.
 */

/** "1,200" is one number; "3,4" is two. */
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

const normalizeNumber = (match: string) => String(Number(match.replaceAll(",", "")));

/** The numbers in a text, normalized: "1,200" → "1200", "12.90" → "12.9", "07" → "7". */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map(([match]) => normalizeNumber(match));
}

/**
 * Single-digit integers are left out: list numbers, counts ("3 medications")
 * and severities are too common to tell apart from claims.
 */
const isClaim = (n: string) => n.includes(".") || Number(n) >= 10;

/** Text form of a tool's input or output, for finding numbers in it. */
export const sourceText = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");

export interface UngroundedNumber {
  value: string;
  /** The answer around its first mention, to judge it without opening the report. */
  context: string;
}

const CONTEXT_CHARS = 50;

function contextAround(text: string, index: number, length: number) {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const end = Math.min(text.length, index + length + CONTEXT_CHARS);
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < text.length ? "…" : ""}`;
}

/**
 * The numbers the answer states that no source contains, each once, in the
 * order they appear. `allowed` lists numbers a case expects the model to
 * state without reading them (e.g. a known duration or threshold).
 */
export function ungroundedNumbers(
  answer: string,
  sources: readonly string[],
  allowed: readonly string[] = [],
): UngroundedNumber[] {
  const known = new Set([...sources, ...allowed].flatMap(numbersIn));
  const found = new Map<string, UngroundedNumber>();
  for (const match of answer.matchAll(NUMBER)) {
    const value = normalizeNumber(match[0]);
    if (!isClaim(value) || known.has(value) || found.has(value)) continue;
    found.set(value, { value, context: contextAround(answer, match.index, match[0].length) });
  }
  return [...found.values()];
}
