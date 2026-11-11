import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDb, type HealthDb, migrateDb, REPO_ROOT } from "@health-mcp/db";
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_RERANKER_MODEL,
  type Embedder,
  LocalEmbedder,
  LocalReranker,
  type Reranker,
  searchPatientChunks,
} from "@health-mcp/rag";
import { API_ROUTES, PatientImportFileSchema, PatientImportResultSchema } from "@health-mcp/shared";

import { parseOptions } from "./cli.js";
import {
  gradeRetrieval,
  type RetrievalCase,
  RetrievalCaseSchema,
  type RetrievalResult,
  type RetrievalSummary,
  summarizeRetrieval,
} from "./retrieval-case.js";
import { provenance } from "./provenance.js";
import { RETRIEVAL_CASES } from "./retrieval-cases.js";
import { FIXTURE, missingEmbeddingModel, request, RESULTS_DIR, startStack } from "./stack.js";

/*
 * Runs the retrieval checks: imports the synthetic patients through apps/api
 * (which indexes them with the local embedding model, as in the app), then
 * runs each case's search on that index, reranked as in the MCP server. No LLM
 * is called, so it is free. Every search is also checked for passages of
 * another patient.
 * Usage: `yarn eval:retrieval [--case <id>]... [--verbose] [--no-rerank] [--sweep]`.
 */

/** Similarity cutoffs `--sweep` tries, around the default. */
const SWEEP = [0.5, 0.52, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.62, 0.64];

interface Search {
  db: HealthDb;
  embedder: Embedder;
  reranker: Reranker | undefined;
  patientIds: Map<string, string>;
}

/** Runs and grades one case, looking up which patient each passage belongs to. */
async function runCase(search: Search, c: RetrievalCase, minSimilarity: number) {
  const patientId = search.patientIds.get(c.patientMrn);
  if (!patientId) throw new Error(`${c.patientMrn} is not in ${FIXTURE}`);
  const found = await searchPatientChunks(search.db, search.embedder, patientId, c.query, {
    k: c.k,
    minSimilarity,
    ...(search.reranker && { reranker: search.reranker }),
  });
  const owners = new Map(
    found.length === 0
      ? []
      : (
          search.db.$client
            .prepare(
              "select id, patient_id from record_chunks " +
                `where id in (${found.map(() => "?").join(", ")})`,
            )
            .all(...found.map((passage) => passage.chunkId)) as { id: number; patient_id: string }[]
        ).map((row) => [row.id, row.patient_id]),
  );
  const passages = found.map((passage) => ({
    ...passage,
    patientId: owners.get(passage.chunkId) ?? "unknown",
  }));
  return gradeRetrieval(c, passages, patientId);
}

function printResult(result: RetrievalResult, verbose: boolean) {
  const rank = result.rank === undefined ? "" : `rank ${result.rank}`;
  const recall =
    result.recall === undefined || result.recall === 1 ? "" : `recall ${result.recall.toFixed(2)}`;
  const details = [rank, recall].filter(Boolean).join(", ");
  console.log(`${result.passed ? "✓" : "✗"} ${result.caseId}${details ? ` (${details})` : ""}`);
  for (const failure of result.failures) console.log(`    ${failure}`);
  if (verbose || !result.passed)
    for (const [i, passage] of result.retrieved.entries()) console.log(`    ${i + 1}. ${passage}`);
}

const percent = (share: number) => `${(share * 100).toFixed(0)}%`;

function describeSummary(label: string, s: RetrievalSummary) {
  return (
    `${label}: ${s.passed}/${s.total} passed, hit rate ${percent(s.hitRate)}, ` +
    `recall ${percent(s.recall)}, MRR ${s.meanReciprocalRank.toFixed(2)}, ` +
    `off-topic empty ${s.offTopicPassed}/${s.offTopicTotal}`
  );
}

/** The summary of all cases and of each split that has cases. */
function summarizeSplits(cases: readonly RetrievalCase[], results: readonly RetrievalResult[]) {
  const splits = {
    all: summarizeRetrieval(cases, results),
    tuning: summarizeRetrieval(
      cases.filter((c) => c.split === "tuning"),
      results,
    ),
    holdout: summarizeRetrieval(
      cases.filter((c) => c.split === "holdout"),
      results,
    ),
  };
  return splits;
}

/** `--sweep`: the measures at each cutoff, to see the trade-off between finding and excluding. */
async function sweep(search: Search, cases: readonly RetrievalCase[]) {
  console.log("Similarity cutoff sweep (keyword matches always count):\n");
  console.log(
    "cutoff           | tuning hit / recall | holdout hit / recall | off-topic empty | isolation",
  );
  const rows = [];
  for (const minSimilarity of SWEEP) {
    const results = [];
    for (const c of cases) results.push(await runCase(search, c, minSimilarity));
    const { all, tuning, holdout } = summarizeSplits(cases, results);
    // Failures that are not about finding relevant passages or returning nothing (isolation).
    const other = results.filter((r) => r.failures.some((f) => f.startsWith("Passage"))).length;
    rows.push({ minSimilarity, tuning, holdout, all, isolationFailures: other });
    const mark = minSimilarity === DEFAULT_MIN_SIMILARITY ? " (current)" : "";
    const pair = (x: RetrievalSummary) =>
      `${percent(x.hitRate).padStart(4)} / ${percent(x.recall).padStart(4)}`;
    const offTopic = `${all.offTopicPassed}/${all.offTopicTotal}`;
    console.log(
      `${minSimilarity.toFixed(2)}${mark.padEnd(10)} | ${pair(tuning).padEnd(19)} | ` +
        `${pair(holdout).padEnd(20)} | ${offTopic.padEnd(15)} | ${other}`,
    );
  }
  return rows;
}

async function main(): Promise<number> {
  const parsed = parseOptions(
    {
      options: {
        case: { type: "string", multiple: true },
        list: { type: "boolean" },
        verbose: { type: "boolean" },
        "no-rerank": { type: "boolean" },
        sweep: { type: "boolean" },
      },
    },
    "yarn eval:retrieval [--list] [--case <id>]... [--verbose] [--no-rerank] [--sweep]",
  );
  if (!parsed) return 2;
  const { values } = parsed;
  const cases = RETRIEVAL_CASES.map((input) => RetrievalCaseSchema.parse(input));
  if (values.list) {
    for (const c of cases) console.log(`${c.id} [${c.split}]: ${c.query}`);
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
  let sweepRows: Awaited<ReturnType<typeof sweep>> | undefined;
  const runProvenance = provenance();
  const stack = await startStack(databasePath);
  try {
    console.log("Importing and indexing the synthetic patients…");
    const fixture = PatientImportFileSchema.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));
    const response = await request(`${stack.apiUrl}${API_ROUTES.patientsImport}`, {
      method: "POST",
      body: JSON.stringify(fixture),
    });
    const { imported } = PatientImportResultSchema.parse(await response.json());
    const search: Search = {
      db: connection.db,
      embedder: new LocalEmbedder({ allowDownload: false }),
      reranker: values["no-rerank"] ? undefined : new LocalReranker({ allowDownload: false }),
      patientIds: new Map(imported.map(({ mrn, patientId }) => [mrn, patientId])),
    };
    const how = search.reranker ? "with" : "without";

    if (values.sweep) {
      console.log(`Sweeping ${selected.length} retrieval checks ${how} the reranker.\n`);
      sweepRows = await sweep(search, selected);
    } else {
      console.log(`Running ${selected.length} retrieval checks ${how} the reranker.\n`);
      for (const c of selected) {
        const result = await runCase(search, c, DEFAULT_MIN_SIMILARITY);
        results.push(result);
        printResult(result, values.verbose ?? false);
      }
    }
  } finally {
    connection.close();
    await stack.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  if (sweepRows) {
    const report = path.join(RESULTS_DIR, `retrieval-sweep-${stamp}.json`);
    writeFileSync(
      report,
      `${JSON.stringify({ provenance: runProvenance, sweep: sweepRows }, null, 2)}\n`,
    );
    console.log(`\nReport: ${path.relative(REPO_ROOT, report)}`);
    return 0;
  }

  const splits = summarizeSplits(selected, results);
  const report = path.join(RESULTS_DIR, `retrieval-${stamp}.json`);
  const settings = {
    provenance: runProvenance,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
    rerankerModel: values["no-rerank"] ? null : DEFAULT_RERANKER_MODEL,
    minSimilarity: DEFAULT_MIN_SIMILARITY,
  };
  writeFileSync(report, `${JSON.stringify({ ...settings, ...splits, results }, null, 2)}\n`);
  console.log("");
  for (const split of ["tuning", "holdout"] as const)
    if (splits[split].total > 0) console.log(describeSummary(split, splits[split]));
  console.log(describeSummary("all", splits.all));
  console.log(`Report: ${path.relative(REPO_ROOT, report)}`);
  return splits.all.passed === splits.all.total ? 0 : 1;
}

process.exitCode = await main();
