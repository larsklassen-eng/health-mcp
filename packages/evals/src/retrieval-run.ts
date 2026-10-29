import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { createDb, migrateDb, REPO_ROOT } from "@health-mcp/db";
import { LocalEmbedder, searchPatientChunks } from "@health-mcp/rag";
import { API_ROUTES, PatientImportFileSchema, PatientImportResultSchema } from "@health-mcp/shared";

import {
  gradeRetrieval,
  type RetrievalResult,
  RetrievalCaseSchema,
  summarizeRetrieval,
} from "./retrieval-case.js";
import { RETRIEVAL_CASES } from "./retrieval-cases.js";
import { FIXTURE, missingEmbeddingModel, request, RESULTS_DIR, startStack } from "./stack.js";

/*
 * Runs the retrieval checks: imports the synthetic patients through apps/api
 * (which indexes them with the local embedding model, as in the app), then
 * runs each case's search on that index. No LLM is called, so it is free.
 * Usage: `yarn eval:retrieval [--case <id>]... [--verbose]`.
 */

function printResult(result: RetrievalResult, verbose: boolean) {
  const rank = result.rank === undefined ? "" : ` (rank ${result.rank})`;
  console.log(`${result.passed ? "✓" : "✗"} ${result.caseId}${rank}`);
  for (const failure of result.failures) console.log(`    ${failure}`);
  if (verbose || !result.passed)
    for (const [i, passage] of result.retrieved.entries()) console.log(`    ${i + 1}. ${passage}`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      case: { type: "string", multiple: true },
      list: { type: "boolean" },
      verbose: { type: "boolean" },
    },
  });
  const cases = RETRIEVAL_CASES.map((input) => RetrievalCaseSchema.parse(input));
  if (values.list) {
    for (const c of cases) console.log(`${c.id}: ${c.query}`);
    return 0;
  }
  const selected = values.case ? cases.filter((c) => values.case!.includes(c.id)) : cases;
  const unknown = (values.case ?? []).filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown case: ${unknown.join(", ")}. See \`yarn eval:retrieval --list\`.`);
    return 2;
  }
  const missingModel = missingEmbeddingModel();
  if (missingModel) {
    console.error(missingModel);
    return 2;
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), "health-mcp-retrieval-"));
  const databasePath = path.join(tempDir, "health.db");
  const connection = createDb({ path: databasePath });
  migrateDb(connection.db);

  const results: RetrievalResult[] = [];
  const stack = await startStack(databasePath);
  try {
    console.log("Importing and indexing the synthetic patients…");
    const fixture = PatientImportFileSchema.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));
    const response = await request(`${stack.apiUrl}${API_ROUTES.patientsImport}`, {
      method: "POST",
      body: JSON.stringify(fixture),
    });
    const { imported } = PatientImportResultSchema.parse(await response.json());
    const patientIds = new Map(imported.map(({ mrn, patientId }) => [mrn, patientId]));

    console.log(`Running ${selected.length} retrieval checks.\n`);
    const embedder = new LocalEmbedder({ allowDownload: false });
    for (const c of selected) {
      const patientId = patientIds.get(c.patientMrn);
      if (!patientId) throw new Error(`${c.patientMrn} is not in ${FIXTURE}`);
      const found = await searchPatientChunks(connection.db, embedder, patientId, c.query, {
        k: c.k,
      });
      const result = gradeRetrieval(c, found);
      results.push(result);
      printResult(result, values.verbose ?? false);
    }
  } finally {
    connection.close();
    await stack.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  const summary = summarizeRetrieval(selected, results);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const report = path.join(RESULTS_DIR, `retrieval-${stamp}.json`);
  writeFileSync(report, `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
  console.log(
    `\n${summary.passed}/${summary.total} passed. ` +
      `Hit rate ${(summary.hitRate * 100).toFixed(0)}%, ` +
      `mean reciprocal rank ${summary.meanReciprocalRank.toFixed(2)}.`,
  );
  console.log(`Report: ${path.relative(REPO_ROOT, report)}`);
  return summary.passed === summary.total ? 0 : 1;
}

process.exitCode = await main();
