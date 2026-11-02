import { type Score, ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./schemas/auth.js";

/*
 * The password rules, shared by apps/api (which enforces them) and apps/web
 * (which shows them while the password is typed). Its own entry point,
 * `@health-mcp/shared/password`, because the zxcvbn dictionaries are large.
 */

/**
 * Lowest zxcvbn score accepted: 3 is "safely unguessable" (about 10^10
 * guesses), plenty against an offline attack on scrypt hashes.
 */
export const PASSWORD_MIN_SCORE = 3;

/** Whose password it is; their names and email make a password easier to guess. */
export interface PasswordOwner {
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
}

export interface PasswordCheck {
  /** zxcvbn's estimate, 0 (guessable in seconds) to 4 (very hard to guess). */
  score: Score;
  /** Whether the password may be used. */
  ok: boolean;
  /** What to fix, when it may not. */
  problem?: string;
  /** zxcvbn's tips for a stronger password. */
  suggestions: string[];
}

let factory: ZxcvbnFactory | undefined;
/** Built on first use: loading the dictionaries takes a moment. */
const zxcvbn = () =>
  (factory ??= new ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...english.dictionary },
    graphs: common.adjacencyGraphs,
    translations: english.translations,
  }));

/** The owner's names and email (whole, and before the @), lowercase; short ones are ignored. */
function personalWords({ email, firstName, lastName }: PasswordOwner): string[] {
  const address = email?.trim().toLowerCase() ?? "";
  const words = [address, address.split("@")[0], firstName, lastName]
    .map((word) => word?.trim().toLowerCase() ?? "")
    .filter((word) => word.length >= 3);
  return [...new Set(words)];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `password` contains `word`, ignoring case. Short words (a name like
 * "Ana") count only on their own, so "banana" is fine.
 */
function containsWord(password: string, word: string): boolean {
  const lower = password.toLowerCase();
  if (word.length >= 4) return lower.includes(word);
  return new RegExp(`(^|[^\\p{L}])${escape(word)}([^\\p{L}]|$)`, "u").test(lower);
}

/** Checks `password` against the rules, for `owner`. */
export function checkPassword(password: string, owner: PasswordOwner = {}): PasswordCheck {
  const personal = personalWords(owner);
  const result = zxcvbn().check(password.slice(0, PASSWORD_MAX_LENGTH), personal);
  const { score } = result;
  const suggestions = result.feedback.suggestions;
  const refuse = (problem: string): PasswordCheck => ({ score, ok: false, problem, suggestions });

  if (password.length < PASSWORD_MIN_LENGTH)
    return refuse(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH)
    return refuse(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  if (personal.some((word) => containsWord(password, word)))
    return refuse("Leave your name and email address out of the password.");
  if (score < PASSWORD_MIN_SCORE)
    return refuse(
      result.feedback.warning ?? "This password is easy to guess. Add more words or characters.",
    );
  return { score, ok: true, suggestions };
}
