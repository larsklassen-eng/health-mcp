import type { ChatUsage } from "@health-mcp/shared";
import { OpenRouter } from "@openrouter/sdk";
import { z } from "zod";

/*
 * An LLM judge for what substring checks get wrong: meaning, not wording.
 * "He has not stopped dexamethasone" contains "stopped"; "Her records don't
 * mention hearing problems" contains none of a list of phrases. Each case's
 * `rubric` lists yes/no statements about the answer, and the judge decides
 * each one. Facts with one right spelling (a lab value) stay substring checks,
 * which are free and never disagree with themselves.
 *
 * A judge is only worth trusting once it agrees with a person on labeled
 * answers: see judge-labels.ts and `yarn eval:judge`.
 */

export interface JudgeInput {
  /** The clinician's message. */
  question: string;
  answer: string;
  /** What the tools returned: the patient's record, as far as the answer could know it. */
  toolResults: { name: string; input: unknown; output?: unknown }[];
  /** Yes/no statements about the answer. */
  criteria: string[];
}

export interface JudgeVerdict {
  criterion: string;
  met: boolean;
  reason: string;
}

export interface Judgement {
  verdicts: JudgeVerdict[];
  usage?: ChatUsage;
}

export type Judge = (input: JudgeInput) => Promise<Judgement>;

export const JUDGE_SYSTEM_PROMPT = `You check answers written by an AI assistant for a clinician, \
about one patient's records. You get the clinician's question, the records the assistant's tools \
returned, the assistant's answer, and numbered criteria.

For each criterion, decide whether the answer meets it:
- Judge what the answer says, as a clinician reading it would understand it. Wording does not \
matter; meaning does. A negation ("not stopped") means the opposite of the word it contains.
- Judge each criterion on its own, and only on what it asks. Do not fail an answer for other \
flaws.
- When a criterion is about the patient's data, the tool results are the record.

Give a one-sentence reason first, then the verdict. Reply with JSON only.`;

const VerdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      criterion: z.int().min(1).describe("The criterion's number"),
      reason: z.string().describe("One sentence"),
      met: z.boolean(),
    }),
  ),
});

const JSON_TEXT = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");

/** The user message for the judge: question, tool results, answer and criteria. */
export function judgeMessage({ question, answer, toolResults, criteria }: JudgeInput): string {
  const tools =
    toolResults.length === 0
      ? "(no tools were called)"
      : toolResults
          .map(({ name, input, output }) => {
            const result = output === undefined ? "(no result)" : JSON_TEXT(output);
            return `${name} ${JSON_TEXT(input)}\n${result}`;
          })
          .join("\n\n");
  return [
    `<question>\n${question}\n</question>`,
    `<tool_results>\n${tools}\n</tool_results>`,
    `<answer>\n${answer}\n</answer>`,
    `<criteria>\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n</criteria>`,
  ].join("\n\n");
}

/** Reads the judge's JSON reply; every criterion must have exactly one verdict. */
export function parseJudgement(text: string, criteria: readonly string[]): JudgeVerdict[] {
  const { verdicts } = VerdictsSchema.parse(JSON.parse(text));
  return criteria.map((criterion, i) => {
    const matching = verdicts.filter((v) => v.criterion === i + 1);
    if (matching.length !== 1)
      throw new Error(`The judge gave ${matching.length} verdicts for criterion ${i + 1}.`);
    const { met, reason } = matching[0]!;
    return { criterion, met, reason };
  });
}

/** The failures to add to a result: one per criterion the answer does not meet. */
export const judgeFailures = (verdicts: readonly JudgeVerdict[]) =>
  verdicts.filter((v) => !v.met).map((v) => `Judge: not met: "${v.criterion}" (${v.reason})`);

export interface OpenRouterJudgeOptions {
  apiKey: string;
  /** OpenRouter model slug, e.g. `anthropic/claude-sonnet-5.5`. */
  model: string;
  /** Override the API base URL (e.g. a local fake server). */
  serverURL?: string;
}

/** A judge on OpenRouter, with the app's data policy and JSON schema output. */
export function openRouterJudge({ apiKey, model, serverURL }: OpenRouterJudgeOptions): Judge {
  const sdk = new OpenRouter({ apiKey, ...(serverURL !== undefined && { serverURL }) });
  const schema = z.toJSONSchema(VerdictsSchema);

  return async (input) => {
    const result = await sdk.chat.send({
      appTitle: "health-mcp evals",
      chatRequest: {
        model,
        maxTokens: 2000,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: judgeMessage(input) },
        ],
        responseFormat: {
          type: "json_schema",
          jsonSchema: { name: "verdicts", schema, strict: true },
        },
        // As in the app, though the data is synthetic.
        provider: { dataCollection: "deny", zdr: true },
        stream: false,
      },
    });
    if (Symbol.asyncIterator in result) throw new Error("The judge's reply was streamed.");
    const content = result.choices[0]?.message.content;
    if (typeof content !== "string" || !content.trim())
      throw new Error("The judge returned no text.");
    const usage = result.usage && {
      modelCalls: 1,
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      ...(result.usage.cost != null && { costUsd: result.usage.cost }),
    };
    return { verdicts: parseJudgement(content, input.criteria), ...(usage && { usage }) };
  };
}

/** The judge model unless `EVAL_JUDGE_MODEL` says otherwise: not the answering model, cheaper. */
export const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-5.5";

/**
 * The judge from the environment (call `loadEnvFile` first): `OPENROUTER_API_KEY`,
 * `EVAL_JUDGE_MODEL` and `OPENROUTER_BASE_URL`. A string says what is missing.
 */
export function judgeFromEnv(): { judge: Judge; model: string } | string {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return "OPENROUTER_API_KEY is not set (in the environment or the root .env).";
  const model = process.env.EVAL_JUDGE_MODEL?.trim() || DEFAULT_JUDGE_MODEL;
  const serverURL = process.env.OPENROUTER_BASE_URL?.trim();
  return { judge: openRouterJudge({ apiKey, model, ...(serverURL && { serverURL }) }), model };
}
