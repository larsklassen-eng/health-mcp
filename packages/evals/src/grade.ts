import { McpToolNameSchema } from "@health-mcp/shared";

import type { EvalCase, EvalResult, Transcript } from "./eval-case.js";
import { numbersIn, sourceText, ungroundedNumbers } from "./grounding.js";
import { statedDuration, utcToday } from "./duration.js";

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

function argsMatch(expected: Record<string, string | number>, input: Record<string, unknown>) {
  return Object.entries(expected).every(([key, value]) => {
    const actual = input[key];
    return typeof value === "string" && typeof actual === "string"
      ? normalize(actual.trim()) === normalize(value)
      : actual === value;
  });
}

const describeCall = (name: string, args?: Record<string, string | number>) =>
  args ? `${name}(${JSON.stringify(args)})` : name;

/**
 * Checks a transcript against a case. Deterministic: no model judges the answer.
 * `context` is what the model read besides the tools (its profile, the
 * clinician's message), for finding the numbers it states. `today` is the
 * date "how long ago" is counted to (`YYYY-MM-DD`; the api's, by default).
 */
export function grade(
  evalCase: EvalCase,
  transcript: Transcript,
  context: readonly string[] = [],
  today: string = utcToday(),
): EvalResult {
  const failures: string[] = [];
  const answer = normalize(transcript.answer);

  if (transcript.error) failures.push(`Error: ${transcript.error}`);
  else if (transcript.stopReason !== undefined && transcript.stopReason !== "stop")
    failures.push(`Stopped early: ${transcript.stopReason}`);
  if (!transcript.error && !answer.trim()) failures.push("The answer is empty.");

  for (const expected of evalCase.expectedToolCalls) {
    const matched = transcript.toolCalls.some(
      (call) =>
        call.name === expected.name &&
        !call.isError &&
        (!expected.args || argsMatch(expected.args, call.input)),
    );
    if (!matched)
      failures.push(`Expected a successful call to ${describeCall(expected.name, expected.args)}.`);
  }
  // A made-up tool name: the api refuses it, but the model meant to read something it never did.
  const unknown = new Set(
    transcript.toolCalls
      .map((call) => call.name)
      .filter((name) => !McpToolNameSchema.safeParse(name).success),
  );
  for (const name of unknown) failures.push(`Called ${name}, which is not one of the tools.`);
  for (const name of evalCase.forbiddenToolCalls) {
    if (transcript.toolCalls.some((call) => call.name === name))
      failures.push(`${name} must not be called.`);
  }
  if (transcript.toolCalls.length > evalCase.maxToolCalls)
    failures.push(
      `Made ${transcript.toolCalls.length} tool calls; at most ${evalCase.maxToolCalls} expected.`,
    );

  for (const text of evalCase.answerIncludes) {
    const options = Array.isArray(text) ? text : [text];
    if (!options.some((option) => answer.includes(normalize(option))))
      failures.push(`The answer should mention ${options.map((o) => `"${o}"`).join(" or ")}.`);
  }
  for (const text of evalCase.answerExcludes) {
    if (answer.includes(normalize(text))) failures.push(`The answer must not mention "${text}".`);
  }

  // A correct duration is worked out, not read: it must not count as an unread number.
  let duration: string | undefined;
  if (evalCase.answerStatesDuration) {
    const { from, to } = evalCase.answerStatesDuration;
    duration = statedDuration(transcript.answer, from, to ?? today);
    if (!duration)
      failures.push(
        to
          ? `The answer should say how long it was from ${from} to ${to}.`
          : `The answer should say how long ago ${from} was (today is ${today}).`,
      );
  }

  const sources = [
    ...context,
    ...transcript.toolCalls.flatMap((call) => [sourceText(call.input), sourceText(call.output)]),
  ];

  return {
    caseId: evalCase.id,
    passed: failures.length === 0,
    toolCalls: transcript.toolCalls.map((call) => call.name),
    failures,
    ungroundedNumbers: ungroundedNumbers(transcript.answer, sources, [
      ...evalCase.allowedNumbers,
      ...(duration ? numbersIn(duration) : []),
    ]),
  };
}
