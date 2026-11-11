import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

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
import { FIXTURE, missingEmbeddingModel, request, RESULTS_DIR, startStack } from "./stack.js";
import { summarizeAttempts } from "./summary.js";
import { parseChatStream } from "./transcript.js";
import { formatUsage, sumUsage } from "./usage.js";

/*
 * Runs the agent eval cases against the real stack: apps/api and
 * apps/mcp-server on a temporary database, and the model on OpenRouter.
 * Every case costs real model calls.
 * Usage: `yarn eval [--case <id>]... [--repeat <n>]`.
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

async function runCase(
  apiUrl: string,
  bundle: PatientImportBundle,
  evalCase: EvalCase,
  attempt: number,
) {
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
  let transcript: Transcript;
  try {
    const response = await call(`${apiUrl}${API_ROUTES.patientChat(patientId)}`, {
      method: "POST",
      body: JSON.stringify({ message: evalCase.userMessage }),
    });
    transcript = parseChatStream(await response.text());
  } catch (error) {
    transcript = { answer: "", toolCalls: [], error: String(error) };
  }
  const durationMs = Math.round(performance.now() - started);

  await call(`${apiUrl}${API_ROUTES.patient(patientId)}`, { method: "DELETE" });
  return {
    ...grade(evalCase, transcript, promptContext(bundle, evalCase)),
    attempt,
    durationMs,
    toolInputs: transcript.toolCalls.map(({ name, input, output }) => ({ name, input, output })),
    ...(transcript.usage && { usage: transcript.usage }),
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
  const { values } = parseArgs({
    options: {
      case: { type: "string", multiple: true },
      list: { type: "boolean" },
      repeat: { type: "string" },
    },
  });
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
  console.log(`Running ${count}${times} with ${model}. Each run of a case calls the model.\n`);

  const stack = await startStack(databasePath);
  const results: EvalResult[] = [];
  try {
    for (const evalCase of selected) {
      const bundle = bundles.get(evalCase.patientMrn);
      if (!bundle) throw new Error(`${evalCase.patientMrn} is not in ${FIXTURE}`);
      for (let attempt = 1; attempt <= repeat; attempt++) {
        const result = await runCase(stack.apiUrl, bundle, evalCase, attempt);
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
  const warnings = results.reduce((sum, r) => sum + r.ungroundedNumbers.length, 0);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const report = path.join(RESULTS_DIR, `${new Date().toISOString().replaceAll(":", "-")}.json`);
  writeFileSync(
    report,
    `${JSON.stringify({ model, repeat, ...summary, warnings, usage, results }, null, 2)}\n`,
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
  if (warnings > 0)
    console.log(`${warnings} number${warnings === 1 ? "" : "s"} to check (⚠ above).`);
  console.log(`Report: ${path.relative(REPO_ROOT, report)}`);
  return summary.passed === summary.total ? 0 : 1;
}

process.exitCode = await main();
