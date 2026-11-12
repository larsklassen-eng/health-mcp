import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDb, loadEnvFile, migrateDb, REPO_ROOT } from "@health-mcp/db";
import {
  API_ROUTES,
  type PatientImportBundle,
  PatientImportFileSchema,
  PatientImportResultSchema,
} from "@health-mcp/shared";

import { CASES } from "./cases.js";
import { type EvalCase, EvalCaseSchema, type EvalResult, type Transcript } from "./eval-case.js";
import { grade } from "./grade.js";
import { sourceText } from "./grounding.js";
import { type Judge, judgeFailures, judgeFromEnv } from "./judge.js";
import { parseOptions } from "./cli.js";
import { FIXTURE, missingEmbeddingModel, request, RESULTS_DIR, startStack } from "./stack.js";
import { summarizeAttempts } from "./summary.js";
import { provenance } from "./provenance.js";
import { parseChatStream } from "./transcript.js";
import { formatUsage, sumUsage } from "./usage.js";

/*
 * Runs the agent eval cases against the real stack: apps/api and
 * apps/mcp-server on a temporary database, and the model on OpenRouter.
 * Every case costs real model calls.
 * Cases with a `rubric` also call the judge model (see judge.ts).
 * Usage: `yarn eval [--case <id>]... [--repeat <n>] [--no-judge] [--model <slug>]`.
 */

const CASE_TIMEOUT_MS = 180_000;
const MAX_REPEAT = 10;
const call = (url: string, init: RequestInit = {}) => request(url, init, CASE_TIMEOUT_MS);

/**
 * What the model reads besides the tools, as the api's system prompt has it:
 * the profile, the lab test names and today's date, plus the clinician's message.
 */
function promptContext(bundle: PatientImportBundle, evalCase: EvalCase): string[] {
  const labTests = [...new Set((bundle.labResults ?? []).map((lab) => lab.testName))];
  const today = new Date().toISOString().slice(0, 10);
  return [JSON.stringify(bundle.patient), labTests.join(", "), today, evalCase.userMessage];
}

/** Sends one message in a patient's chat and reads the streamed answer. */
async function ask(apiUrl: string, patientId: string, message: string): Promise<Transcript> {
  try {
    const response = await call(`${apiUrl}${API_ROUTES.patientChat(patientId)}`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    return parseChatStream(await response.text());
  } catch (error) {
    return { answer: "", toolCalls: [], error: String(error) };
  }
}

async function runCase(
  apiUrl: string,
  fixtureBundle: PatientImportBundle,
  evalCase: EvalCase,
  attempt: number,
  judge: Judge | undefined,
): Promise<EvalResult> {
  const bundle = {
    ...fixtureBundle,
    symptoms: [...(fixtureBundle.symptoms ?? []), ...evalCase.addSymptoms],
  };
  // A fresh copy of the patient per case, so no case sees another's chat.
  const imported = PatientImportResultSchema.parse(
    await (
      await call(`${apiUrl}${API_ROUTES.patientsImport}`, {
        method: "POST",
        body: JSON.stringify({ version: 1, patients: [bundle] }),
      })
    ).json(),
  );
  const patientId = imported.imported[0]!.patientId;

  const started = performance.now();
  // Follow-up cases: the earlier messages first, in the same chat. Only the last answer is graded.
  const earlier: { question: string; transcript: Transcript }[] = [];
  let transcript: Transcript | undefined;
  for (const question of evalCase.earlierMessages) {
    const reply = await ask(apiUrl, patientId, question);
    earlier.push({ question, transcript: reply });
    if (reply.error) {
      transcript = { ...reply, error: `Earlier message "${question}": ${reply.error}` };
      break;
    }
  }
  transcript ??= await ask(apiUrl, patientId, evalCase.userMessage);
  const durationMs = Math.round(performance.now() - started);

  await call(`${apiUrl}${API_ROUTES.patient(patientId)}`, { method: "DELETE" });
  // The model also read the earlier answers and their tool results.
  const context = [
    ...promptContext(bundle, evalCase),
    ...earlier.flatMap(({ question, transcript: t }) => [
      question,
      t.answer,
      ...t.toolCalls.flatMap((call) => [sourceText(call.input), sourceText(call.output)]),
    ]),
  ];
  const graded = grade(evalCase, transcript, context);
  if (judge && evalCase.rubric.length > 0 && transcript.answer.trim() !== "") {
    try {
      const { verdicts, usage } = await judge({
        earlierTurns: earlier.map(({ question, transcript: t }) => ({
          question,
          answer: t.answer,
        })),
        question: evalCase.userMessage,
        answer: transcript.answer,
        toolResults: transcript.toolCalls,
        criteria: evalCase.rubric,
      });
      graded.failures.push(...judgeFailures(verdicts));
      graded.judgeVerdicts = verdicts;
      if (usage) graded.judgeUsage = usage;
    } catch (error) {
      graded.failures.push(`Judge error: ${String(error)}`);
    }
    graded.passed = graded.failures.length === 0;
  }
  return {
    ...graded,
    attempt,
    durationMs,
    toolInputs: transcript.toolCalls.map(({ name, input, output }) => ({ name, input, output })),
    // The earlier messages' cost counts too: the case cannot run without them.
    ...(transcript.usage && {
      usage: sumUsage([...earlier.map(({ transcript: t }) => t.usage), transcript.usage]),
    }),
    answer: transcript.answer,
  };
}

function printResult(result: EvalResult, repeat: number) {
  const seconds = ((result.durationMs ?? 0) / 1000).toFixed(1);
  const tools = result.toolCalls.length > 0 ? result.toolCalls.join(", ") : "no tools";
  const attempt = repeat > 1 ? ` [${result.attempt}/${repeat}]` : "";
  const mark = result.passed ? "✓" : "✗";
  console.log(`${mark} ${result.caseId}${attempt} (${seconds}s; ${tools})`);
  console.log(`    ${formatUsage(result.usage)}`);
  if (result.judgeUsage) console.log(`    Judge: ${formatUsage(result.judgeUsage)}`);
  for (const failure of result.failures) console.log(`    ${failure}`);
  for (const { value, context } of result.ungroundedNumbers)
    console.log(`    ⚠ ${value} is in no tool result or the profile: ${context}`);
}

/** `--repeat`: a whole number from 1 to MAX_REPEAT, or undefined when it is not one. */
function parseRepeat(value: string | undefined): number | undefined {
  if (value === undefined) return 1;
  const repeat = Number(value);
  return Number.isInteger(repeat) && repeat >= 1 && repeat <= MAX_REPEAT ? repeat : undefined;
}

async function main(): Promise<number> {
  const parsed = parseOptions(
    {
      options: {
        case: { type: "string", multiple: true },
        list: { type: "boolean" },
        repeat: { type: "string" },
        "no-judge": { type: "boolean" },
        model: { type: "string" },
      },
    },
    "yarn eval [--list] [--case <id>]... [--repeat <n>] [--no-judge] [--model <slug>]",
  );
  if (!parsed) return 2;
  const { values } = parsed;
  const repeat = parseRepeat(values.repeat);
  if (repeat === undefined) {
    console.error(`--repeat takes a whole number from 1 to ${MAX_REPEAT}.`);
    return 2;
  }
  const cases = CASES.map((input) => EvalCaseSchema.parse(input));
  if (values.list) {
    for (const evalCase of cases) console.log(`${evalCase.id}: ${evalCase.description}`);
    return 0;
  }
  const selected = values.case ? cases.filter((c) => values.case!.includes(c.id)) : cases;
  const unknown = (values.case ?? []).filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown case: ${unknown.join(", ")}. See \`yarn eval --list\`.`);
    return 2;
  }

  // --model answers with another model, e.g. a cheaper one to see whether the cases are
  // too easy. Set before the .env is read, which never overrides the environment.
  if (values.model) process.env.OPENROUTER_MODEL = values.model;
  loadEnvFile();
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY is not set (in the environment or the root .env).");
    return 2;
  }

  const missingModel = missingEmbeddingModel();
  if (missingModel) {
    console.error(missingModel);
    return 2;
  }

  const withRubric = selected.filter((c) => c.rubric.length > 0).length;
  let judge: Judge | undefined;
  let judgeModel: string | undefined;
  if (withRubric > 0 && !values["no-judge"]) {
    const created = judgeFromEnv();
    if (typeof created === "string") {
      console.error(created);
      return 2;
    }
    ({ judge, model: judgeModel } = created);
  }

  const fixture = PatientImportFileSchema.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));
  const bundles = new Map(fixture.patients.map((bundle) => [bundle.patient.mrn, bundle]));

  const tempDir = mkdtempSync(path.join(tmpdir(), "health-mcp-evals-"));
  const databasePath = path.join(tempDir, "health.db");
  const connection = createDb({ path: databasePath });
  migrateDb(connection.db);
  connection.close();

  const model = process.env.OPENROUTER_MODEL ?? "the api's default model";
  const count = `${selected.length} eval case${selected.length === 1 ? "" : "s"}`;
  const times = repeat > 1 ? `, ${repeat} times each` : "";
  console.log(`Running ${count}${times} with ${model}. Each run of a case calls the model.`);
  if (judgeModel) console.log(`${withRubric} of them are also judged by ${judgeModel}.`);
  else if (withRubric > 0)
    console.log(`--no-judge: the rubric of ${withRubric} of them is not checked.`);
  console.log("");

  // What produced this run, recorded before it starts (see provenance.ts).
  const runProvenance = provenance();
  const stack = await startStack(databasePath);
  const results: EvalResult[] = [];
  try {
    for (const evalCase of selected) {
      const bundle = bundles.get(evalCase.patientMrn);
      if (!bundle) throw new Error(`${evalCase.patientMrn} is not in ${FIXTURE}`);
      for (let attempt = 1; attempt <= repeat; attempt++) {
        const result = await runCase(stack.apiUrl, bundle, evalCase, attempt, judge);
        results.push(result);
        printResult(result, repeat);
      }
    }
  } finally {
    await stack.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  const summary = summarizeAttempts(results);
  const usage = sumUsage(results.map((r) => r.usage));
  const judgeUsage = sumUsage(results.map((r) => r.judgeUsage));
  const warnings = results.reduce((sum, r) => sum + r.ungroundedNumbers.length, 0);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const report = path.join(RESULTS_DIR, `${new Date().toISOString().replaceAll(":", "-")}.json`);
  writeFileSync(
    report,
    `${JSON.stringify(
      {
        model,
        judgeModel,
        repeat,
        provenance: runProvenance,
        ...summary,
        warnings,
        usage,
        judgeUsage,
        results,
      },
      null,
      2,
    )}\n`,
  );

  console.log("");
  if (repeat > 1) {
    for (const c of summary.cases.filter((c) => c.passes < c.attempts))
      console.log(`${c.passes === 0 ? "✗" : "~"} ${c.caseId}: ${c.passes}/${c.attempts} passed`);
    const cases = summary.cases.length;
    console.log(
      `Every attempt passed (pass^${repeat}): ${summary.passAll}/${cases} cases. ` +
        `At least one passed (pass@${repeat}): ${summary.passAny}/${cases}. ` +
        `Flaky: ${summary.flaky.length}.`,
    );
  }
  console.log(`${summary.passed}/${summary.total} passed. Total: ${formatUsage(usage)}.`);
  if (judgeModel) console.log(`Judge total: ${formatUsage(judgeUsage)}.`);
  if (warnings > 0)
    console.log(`${warnings} number${warnings === 1 ? "" : "s"} to check (⚠ above).`);
  console.log(`Report: ${path.relative(REPO_ROOT, report)}`);
  return summary.passed === summary.total ? 0 : 1;
}

process.exitCode = await main();
