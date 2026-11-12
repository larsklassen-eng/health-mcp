import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@health-mcp/db";

import { parseOptions } from "./cli.js";
import {
  type AgentOutcome,
  AgentReportSchema,
  compareAgentReports,
  compareRetrievalReports,
  RetrievalReportSchema,
  type SettingChange,
} from "./compare.js";
import { kindOf, reportFiles } from "./reports.js";
import { RESULTS_DIR } from "./stack.js";

/*
 * Compares two eval reports: what differed between the runs, and which cases
 * changed. Without files, the two latest reports of the kind asked for.
 * Usage: `yarn eval:compare [--retrieval] [<older.json> <newer.json>]`.
 */

type Kind = "agent" | "retrieval";

const read = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

/** The case ids a report ran, sorted and joined, to find reports that ran the same cases. */
function caseSet(file: string): string | undefined {
  try {
    const { results } = read(file) as { results?: { caseId?: unknown }[] };
    return [...new Set((results ?? []).map((r) => String(r.caseId)))].sort().join(",");
  } catch {
    return undefined;
  }
}

/**
 * The latest report of a kind, and the latest earlier one that ran the same
 * cases (a run of a few `--case`s would otherwise be compared with a full run);
 * failing that, the one just before. Names start with the time, so they sort.
 */
function latestTwo(kind: Kind): string[] {
  const files = reportFiles(kind);
  if (files.length < 2) return files;
  const newest = files.at(-1)!;
  const earlier = files.slice(0, -1);
  const cases = caseSet(newest);
  const same = earlier.findLast((file) => caseSet(file) === cases);
  return [same ?? earlier.at(-1)!, newest];
}
const relative = (file: string) => path.relative(REPO_ROOT, path.resolve(file));

function printSettings(settings: SettingChange[], provenanceRecorded: boolean) {
  if (settings.length === 0) console.log("No recorded setting differs.");
  else {
    console.log("What differed between the runs:");
    for (const setting of settings)
      console.log(`  ${setting.name}: ${setting.before} → ${setting.after}`);
  }
  if (!provenanceRecorded)
    console.log("(One report was written before reports recorded the code, prompt and tools.)");
  console.log("");
}

/** Added and removed cases on one line each: they are not changes in behavior. */
function printAddedRemoved(added: string[], removed: string[]) {
  if (added.length > 0) console.log(`Added (${added.length}): ${added.join(", ")}`);
  if (removed.length > 0) console.log(`Removed (${removed.length}): ${removed.join(", ")}`);
}

const outcome = (o?: AgentOutcome) => (o ? `${o.passes}/${o.attempts}` : "-");
const LABELS = {
  broke: "broke",
  worse: "worse",
  fixed: "fixed",
  better: "better",
  added: "added",
  removed: "removed",
} as const;

function compareAgent(older: string, newer: string) {
  const result = compareAgentReports(
    AgentReportSchema.parse(read(older)),
    AgentReportSchema.parse(read(newer)),
  );
  printSettings(result.settings, result.provenanceRecorded);
  const { before, after } = result;
  const cost = (usd?: number) => (usd === undefined ? "cost not recorded" : `$${usd.toFixed(2)}`);
  console.log(
    `Before: ${before.passAll}/${before.cases} cases passed every attempt ` +
      `(${before.passedAttempts}/${before.attempts} attempts), ${cost(before.costUsd)}.`,
  );
  console.log(
    `After:  ${after.passAll}/${after.cases} cases passed every attempt ` +
      `(${after.passedAttempts}/${after.attempts} attempts), ${cost(after.costUsd)}.\n`,
  );
  const changed = result.changes.filter((c) => c.kind !== "added" && c.kind !== "removed");
  if (changed.length === 0) console.log("No case changed.");
  for (const change of changed) {
    const passes = `${outcome(change.before)} → ${outcome(change.after)}`;
    console.log(`${LABELS[change.kind].padEnd(7)} ${change.caseId} (${passes})`);
    if (change.kind === "broke" || change.kind === "worse")
      for (const failure of change.after?.failures ?? []) console.log(`        ${failure}`);
  }
  printAddedRemoved(
    result.changes.filter((c) => c.kind === "added").map((c) => c.caseId),
    result.changes.filter((c) => c.kind === "removed").map((c) => c.caseId),
  );
  console.log(`${result.unchanged} unchanged.`);
}

function compareRetrieval(older: string, newer: string) {
  const result = compareRetrievalReports(
    RetrievalReportSchema.parse(read(older)),
    RetrievalReportSchema.parse(read(newer)),
  );
  printSettings(result.settings, result.provenanceRecorded);
  console.log(`Before: ${result.before.passed}/${result.before.cases} passed.`);
  console.log(`After:  ${result.after.passed}/${result.after.cases} passed.\n`);
  const isAdded = (c: { what: string[] }) => c.what[0] === "added";
  const isRemoved = (c: { what: string[] }) => c.what[0] === "removed";
  const changed = result.changes.filter((c) => !isAdded(c) && !isRemoved(c));
  if (changed.length === 0) console.log("No check changed.");
  for (const change of changed) {
    console.log(
      `${change.worse ? "worse " : "      "} ${change.caseId}: ${change.what.join(", ")}`,
    );
    if (change.worse)
      for (const failure of change.after?.failures ?? []) console.log(`        ${failure}`);
  }
  printAddedRemoved(
    result.changes.filter(isAdded).map((c) => c.caseId),
    result.changes.filter(isRemoved).map((c) => c.caseId),
  );
  console.log(`${result.unchanged} unchanged.`);
}

function main(): number {
  const parsed = parseOptions(
    { options: { retrieval: { type: "boolean" } }, allowPositionals: true },
    "yarn eval:compare [--retrieval] [<older.json> <newer.json>]",
  );
  if (!parsed) return 2;
  const { values, positionals } = parsed;
  if (positionals.length !== 0 && positionals.length !== 2) {
    console.error("Give two reports (older first), or none for the two latest.");
    return 2;
  }
  // Relative to the current directory, or else to the repo root (`yarn workspace` runs in
  // packages/evals, while a report path is usually typed from the root).
  const locate = (file: string) =>
    [path.resolve(file), path.resolve(REPO_ROOT, file)].find(existsSync) ?? path.resolve(file);
  const files =
    positionals.length === 2
      ? positionals.map(locate)
      : latestTwo(values.retrieval ? "retrieval" : "agent");
  if (files.length < 2) {
    console.error(`Fewer than two reports to compare in ${relative(RESULTS_DIR)}.`);
    return 2;
  }
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(`Not found: ${missing.map(relative).join(", ")}.`);
    return 2;
  }
  const [older, newer] = files as [string, string];
  const kinds = new Set(files.map(kindOf));
  if (kinds.has("sweep") || kinds.size > 1) {
    console.error("Both reports must be agent reports, or both retrieval reports (not sweeps).");
    return 2;
  }
  console.log(`Comparing ${relative(older)} → ${relative(newer)}\n`);
  if (kinds.has("retrieval")) compareRetrieval(older, newer);
  else compareAgent(older, newer);
  return 0;
}

process.exitCode = main();
