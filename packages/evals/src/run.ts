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
import { parseChatStream } from "./transcript.js";
import { formatUsage, sumUsage } from "./usage.js";

/*
 * Runs the agent eval cases against the real stack: apps/api and
 * apps/mcp-server on a temporary database, and the model on OpenRouter.
 * Every case costs real model calls. Usage: `yarn eval [--case <id>]...`.
 */

const CASE_TIMEOUT_MS = 180_000;
const call = (url: string, init: RequestInit = {}) => request(url, init, CASE_TIMEOUT_MS);

async function runCase(apiUrl: string, bundle: PatientImportBundle, evalCase: EvalCase) {
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
    ...grade(evalCase, transcript),
    durationMs,
    toolInputs: transcript.toolCalls.map(({ name, input }) => ({ name, input })),
    ...(transcript.usage && { usage: transcript.usage }),
    answer: transcript.answer,
  };
}

function printResult(result: EvalResult) {
  const seconds = ((result.durationMs ?? 0) / 1000).toFixed(1);
  const tools = result.toolCalls.length > 0 ? result.toolCalls.join(", ") : "no tools";
  console.log(`${result.passed ? "✓" : "✗"} ${result.caseId} (${seconds}s; ${tools})`);
  console.log(`    ${formatUsage(result.usage)}`);
  for (const failure of result.failures) console.log(`    ${failure}`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { case: { type: "string", multiple: true }, list: { type: "boolean" } },
  });
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
  console.log(`Running ${count} with ${model}. Each case calls the model.\n`);

  const stack = await startStack(databasePath);
  const results: EvalResult[] = [];
  try {
    for (const evalCase of selected) {
      const bundle = bundles.get(evalCase.patientMrn);
      if (!bundle) throw new Error(`${evalCase.patientMrn} is not in ${FIXTURE}`);
      const result = await runCase(stack.apiUrl, bundle, evalCase);
      results.push(result);
      printResult(result);
    }
  } finally {
    await stack.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.passed).length;
  const usage = sumUsage(results.map((r) => r.usage));
  mkdirSync(RESULTS_DIR, { recursive: true });
  const report = path.join(RESULTS_DIR, `${new Date().toISOString().replaceAll(":", "-")}.json`);
  const summary = { model, passed, total: results.length, usage, results };
  writeFileSync(report, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n${passed}/${results.length} passed. Total: ${formatUsage(usage)}.`);
  console.log(`Report: ${path.relative(REPO_ROOT, report)}`);
  return passed === results.length ? 0 : 1;
}

process.exitCode = await main();
