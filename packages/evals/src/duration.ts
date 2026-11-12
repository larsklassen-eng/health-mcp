/*
 * Checks a "how long" answer: between two dates in the record, or from one to
 * today. The fixture's dates are fixed while today moves on, so a duration to
 * today is worked out when the eval runs, from the same "today" the api gives
 * the model (the UTC date). The answer may give it in days, weeks, months or
 * years, rounded either way, in digits or words ("about a year", "12.5 months",
 * "54 weeks").
 */

const DAY_MS = 86_400_000;
const DAYS_PER = { day: 1, week: 7, month: 30.44, year: 365.25 } as const;
type Unit = keyof typeof DAYS_PER;

/**
 * How far off a stated value may be, in its unit: a day either way for days
 * (time zones, counting the first day or not); otherwise rounded to the nearest
 * unit ("54 weeks" for 54.3), a little more for months, whose length varies.
 */
const TOLERANCE: Record<Unit, number> = { day: 1, week: 0.5, month: 0.6, year: 0.5 };

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const AMOUNT = `(\\d+(?:\\.\\d+)?|${Object.keys(WORDS).join("|")})`;
const DURATION = new RegExp(`\\b${AMOUNT}[\\s-]+(day|week|month|year)s?\\b`, "gi");

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Today as the api has it: the UTC date. */
export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * The first duration in the answer that matches the time from `from` to `to`
 * (`YYYY-MM-DD`), as written (e.g. "54 weeks"); undefined when none does.
 */
export function statedDuration(answer: string, from: string, to: string): string | undefined {
  const days = daysBetween(from, to);
  for (const match of answer.matchAll(DURATION)) {
    const amount = match[1]!.toLowerCase();
    const value = WORDS[amount] ?? Number(amount);
    const unit = match[2]!.toLowerCase() as Unit;
    if (Math.abs(value - days / DAYS_PER[unit]) <= TOLERANCE[unit]) return match[0];
  }
  return undefined;
}
