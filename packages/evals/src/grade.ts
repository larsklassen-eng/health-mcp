import type { EvalCase, EvalResult, Transcript } from "./eval-case.js";

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

/** Checks a transcript against a case. Deterministic: no model judges the answer. */
export function grade(evalCase: EvalCase, transcript: Transcript): EvalResult {
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

  return {
    caseId: evalCase.id,
    passed: failures.length === 0,
    toolCalls: transcript.toolCalls.map((call) => call.name),
    failures,
  };
}
