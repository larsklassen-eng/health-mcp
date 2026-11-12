import { readdirSync } from "node:fs";
import path from "node:path";

import { RESULTS_DIR } from "./stack.js";

/*
 * The reports in eval-results/, by kind. Names start with the time the run
 * started (`2026-11-12T11-06-40.824Z.json`), so they sort oldest first.
 */

export type ReportKind = "agent" | "retrieval" | "sweep";

export function kindOf(file: string): ReportKind {
  const name = path.basename(file);
  if (name.startsWith("retrieval-sweep-")) return "sweep";
  return name.startsWith("retrieval-") ? "retrieval" : "agent";
}

/** Every report of a kind, oldest first; empty when there is no eval-results/. */
export function reportFiles(kind: ReportKind): string[] {
  let names: string[];
  try {
    names = readdirSync(RESULTS_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json") && kindOf(name) === kind)
    .sort()
    .map((name) => path.join(RESULTS_DIR, name));
}

/** When the run started, from the report's name; undefined for a name without a time. */
export function reportTime(file: string): Date | undefined {
  const match = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}(?:\.\d+)?)Z/.exec(path.basename(file));
  if (!match) return undefined;
  const [, date, hours, minutes, seconds] = match;
  const time = new Date(`${date}T${hours}:${minutes}:${seconds}Z`);
  return Number.isNaN(time.getTime()) ? undefined : time;
}
