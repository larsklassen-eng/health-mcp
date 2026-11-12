import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { loadEnvFile, REPO_ROOT } from "@health-mcp/db";

import { CASES } from "./cases.js";
import { parseOptions } from "./cli.js";
import { EvalCaseSchema } from "./eval-case.js";
import {
  datasetUpload,
  evaluationsFor,
  experimentFor,
  PhoenixReportSchema,
  runFor,
} from "./phoenix.js";
import { kindOf, reportFiles, reportTime } from "./reports.js";

/*
 * Uploads agent eval reports to Phoenix as experiments (see phoenix.ts). Free:
 * no model is called. A report already uploaded is skipped, so it is safe to
 * run again. Reports hold the (synthetic) patients' records, so use a local
 * Phoenix, the same one the traces go to.
 * Usage: `yarn eval:phoenix [--all] [<report.json> ...]`.
 */

const USAGE = "yarn eval:phoenix [--all] [<report.json> ...]";

class Phoenix {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async call<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${method} ${route}: ${response.status} ${text.slice(0, 300)}`.trim());
    return JSON.parse(text) as T;
  }

  /** Every page of a cursor-paginated list. */
  async all<T>(route: string): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    do {
      const sep = route.includes("?") ? "&" : "?";
      const page: { data: T[]; next_cursor: string | null } = await this.call(
        "GET",
        cursor ? `${route}${sep}cursor=${encodeURIComponent(cursor)}` : route,
      );
      items.push(...page.data);
      cursor = page.next_cursor;
    } while (cursor);
    return items;
  }
}

/** Relative to the current directory, or else to the repo root (as in eval:compare). */
const locate = (file: string) =>
  [path.resolve(file), path.resolve(REPO_ROOT, file)].find(existsSync) ?? path.resolve(file);

const relative = (file: string) => path.relative(REPO_ROOT, file);

async function main(): Promise<number> {
  const parsed = parseOptions(
    { options: { all: { type: "boolean" } }, allowPositionals: true },
    USAGE,
  );
  if (!parsed) return 2;
  const { values, positionals } = parsed;

  const files = positionals.length > 0 ? positionals.map(locate) : reportFiles("agent");
  const chosen = values.all || positionals.length > 0 ? files : files.slice(-1);
  if (chosen.length === 0) {
    console.error("No agent report in eval-results/. Run `yarn eval` first.");
    return 2;
  }
  const missing = chosen.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(`Not found: ${missing.map(relative).join(", ")}.`);
    return 2;
  }
  const notAgent = chosen.filter((file) => kindOf(file) !== "agent");
  if (notAgent.length > 0) {
    console.error(`Only agent reports can be uploaded: ${notAgent.map(relative).join(", ")}.`);
    return 2;
  }

  loadEnvFile();
  const baseUrl = (process.env.PHOENIX_COLLECTOR_ENDPOINT ?? "http://localhost:6006").replace(
    /\/+$/,
    "",
  );
  const phoenix = new Phoenix(baseUrl, process.env.PHOENIX_API_KEY?.trim() || undefined);
  try {
    await phoenix.call("GET", "/v1/datasets?limit=1");
  } catch (error) {
    console.error(`Phoenix is not reachable at ${baseUrl}: ${(error as Error).message}`);
    console.error("Start it with `docker compose --profile monitoring up -d phoenix`.");
    return 1;
  }

  // The dataset follows the cases as they are now.
  const cases = CASES.map((input) => EvalCaseSchema.parse(input));
  const upload = await phoenix.call<{ data: { dataset_id: string } }>(
    "POST",
    "/v1/datasets/upload?sync=true",
    datasetUpload(cases),
  );
  const datasetId = upload.data.dataset_id;
  const examples = await phoenix.call<{ data: { examples: { id: string; node_id: string }[] } }>(
    "GET",
    `/v1/datasets/${encodeURIComponent(datasetId)}/examples`,
  );
  const nodeIds = new Map(examples.data.examples.map((e) => [e.id, e.node_id]));
  const experimentsRoute = `/v1/datasets/${encodeURIComponent(datasetId)}/experiments`;
  const uploaded = new Set(
    (await phoenix.all<{ metadata?: { report?: unknown } }>(experimentsRoute)).map((e) =>
      String(e.metadata?.report),
    ),
  );

  let created = 0;
  for (const file of chosen) {
    const name = path.basename(file);
    if (uploaded.has(name)) {
      console.log(`- ${name}: already in Phoenix`);
      continue;
    }
    const report = PhoenixReportSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!report.success) {
      console.log(`- ${name}: skipped, not an agent report this version can read`);
      continue;
    }
    const startedAt = reportTime(file) ?? statSync(file).mtime;
    const experiment = await phoenix.call<{ data: { id: string } }>(
      "POST",
      experimentsRoute,
      experimentFor(report.data, file, startedAt),
    );
    const removed = new Set<string>();
    let runs = 0;
    for (const result of report.data.results) {
      const nodeId = nodeIds.get(result.caseId);
      if (!nodeId) {
        removed.add(result.caseId);
        continue;
      }
      const run = await phoenix.call<{ data: { id: string } }>(
        "POST",
        `/v1/experiments/${encodeURIComponent(experiment.data.id)}/runs`,
        runFor(result, nodeId, startedAt),
      );
      const end = new Date(startedAt.getTime() + (result.durationMs ?? 0)).toISOString();
      for (const evaluation of evaluationsFor(result))
        await phoenix.call("POST", "/v1/experiment_evaluations", {
          experiment_run_id: run.data.id,
          start_time: end,
          end_time: end,
          ...evaluation,
        });
      runs++;
    }
    created++;
    const note = removed.size > 0 ? ` (no longer cases, skipped: ${[...removed].join(", ")})` : "";
    console.log(`+ ${name}: ${runs} runs${note}`);
  }
  console.log(
    `\n${created} experiment(s) uploaded. Open ${baseUrl}/datasets/${datasetId}/experiments`,
  );
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
