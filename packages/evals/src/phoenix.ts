import path from "node:path";

import { z } from "zod";

import { type EvalCase, EvalResultSchema } from "./eval-case.js";
import { ProvenanceSchema } from "./compare.js";

/*
 * Agent eval reports as Phoenix experiments, to browse and compare runs in
 * Phoenix's UI: the cases are a dataset (one example per case), each report an
 * experiment over it, each answer a run, and the grades the run's evaluations.
 * Only uploads what a report already holds, so it calls no model. The payloads
 * are built here, without network, so they can be tested; phoenix-run.ts sends
 * them. Shapes follow Phoenix's REST API (`/v1/datasets/upload`,
 * `/v1/datasets/{id}/experiments`, `/v1/experiments/{id}/runs`,
 * `/v1/experiment_evaluations`), checked against Phoenix 20.27.
 */

export const DATASET_NAME = "health-mcp agent eval";

/** A report as written by run.ts; the fields Phoenix shows. */
export const PhoenixReportSchema = z.object({
  model: z.string().optional(),
  judgeModel: z.string().optional(),
  repeat: z.number().optional(),
  provenance: ProvenanceSchema.optional(),
  usage: z.object({ costUsd: z.number().optional() }).optional(),
  judgeUsage: z.object({ costUsd: z.number().optional() }).optional(),
  results: z.array(EvalResultSchema),
});
export type PhoenixReport = z.infer<typeof PhoenixReportSchema>;

/**
 * The cases as one dataset upload. `update` makes the dataset match the cases:
 * changed cases get a new version, removed ones leave it (older experiments
 * keep the version they ran on). The case id is the example's stable id.
 */
export function datasetUpload(cases: EvalCase[]) {
  return {
    action: "update" as const,
    name: DATASET_NAME,
    description: "The agent eval's cases (packages/evals/src/cases.ts), synthetic patients only.",
    example_ids: cases.map((c) => c.id),
    inputs: cases.map((c) => ({
      caseId: c.id,
      patientMrn: c.patientMrn,
      earlierMessages: c.earlierMessages,
      userMessage: c.userMessage,
    })),
    // What a good answer must do: Phoenix shows it as the reference output.
    outputs: cases.map((c) => ({
      expectedToolCalls: c.expectedToolCalls,
      forbiddenToolCalls: c.forbiddenToolCalls,
      answerIncludes: c.answerIncludes,
      answerExcludes: c.answerExcludes,
      answerStatesDuration: c.answerStatesDuration ?? null,
      maxToolCalls: c.maxToolCalls,
      rubric: c.rubric,
    })),
    metadata: cases.map((c) => ({ description: c.description })),
  };
}

/** The model's name without its provider, e.g. `claude-haiku-5.5`. */
const shortModel = (model?: string) => model?.split("/").at(-1) ?? "default model";

/** The experiment for one report; `report` in its metadata is how a second upload is spotted. */
export function experimentFor(report: PhoenixReport, file: string, startedAt: Date) {
  const attempts = Math.max(1, ...report.results.map((r) => r.attempt ?? 1));
  const p = report.provenance;
  const when = startedAt.toISOString().slice(0, 16).replace("T", " ");
  return {
    name: `${shortModel(report.model)} · ${when}`,
    description: `Uploaded from eval-results/${path.basename(file)}.`,
    repetitions: report.repeat ?? attempts,
    metadata: {
      report: path.basename(file),
      model: report.model ?? null,
      judgeModel: report.judgeModel ?? null,
      gitCommit: p?.gitCommit?.slice(0, 7) ?? null,
      uncommittedChanges: p?.gitDirty ?? null,
      systemPromptHash: p?.systemPromptHash ?? null,
      toolsHash: p?.toolsHash ?? null,
      costUsd: report.usage?.costUsd ?? null,
      judgeCostUsd: report.judgeUsage?.costUsd ?? null,
    },
  };
}

type Result = PhoenixReport["results"][number];

interface Evaluation {
  name: string;
  annotator_kind: "CODE" | "LLM";
  result: { label: string; score: number; explanation: string | null };
}

/**
 * The grades of one answer. Names stay the same across experiments, so Phoenix
 * can compare them: `passed` (all checks), `judge` (share of rubric statements
 * met, when the case has any), `ungrounded numbers` (count) and `cost (USD)`.
 */
export function evaluationsFor(result: Result): Evaluation[] {
  const evaluations: Evaluation[] = [
    {
      name: "passed",
      annotator_kind: "CODE",
      result: {
        label: result.passed ? "pass" : "fail",
        score: result.passed ? 1 : 0,
        explanation: result.failures.join("\n") || null,
      },
    },
  ];
  const verdicts = result.judgeVerdicts ?? [];
  if (verdicts.length > 0) {
    const met = verdicts.filter((v) => v.met).length;
    const unmet = verdicts.filter((v) => !v.met).map((v) => `Not met: ${v.criterion} ${v.reason}`);
    evaluations.push({
      name: "judge",
      annotator_kind: "LLM",
      result: {
        label: `${met}/${verdicts.length} met`,
        score: met / verdicts.length,
        explanation: unmet.join("\n") || null,
      },
    });
  }
  const numbers = result.ungroundedNumbers;
  evaluations.push({
    name: "ungrounded numbers",
    annotator_kind: "CODE",
    result: {
      label: String(numbers.length),
      score: numbers.length,
      explanation: numbers.map((n) => `${n.value}: ${n.context}`).join("\n") || null,
    },
  });
  if (result.usage?.costUsd !== undefined)
    evaluations.push({
      name: "cost (USD)",
      annotator_kind: "CODE",
      result: {
        label: `$${result.usage.costUsd.toFixed(4)}`,
        score: result.usage.costUsd,
        explanation: null,
      },
    });
  return evaluations;
}

/**
 * One answer as an experiment run. Reports keep how long an answer took, not
 * when it started, so every run starts at the report's time.
 */
export function runFor(result: Result, exampleNodeId: string, startedAt: Date) {
  const end = new Date(startedAt.getTime() + (result.durationMs ?? 0));
  return {
    dataset_example_id: exampleNodeId,
    repetition_number: result.attempt ?? 1,
    start_time: startedAt.toISOString(),
    end_time: end.toISOString(),
    output: {
      answer: result.answer ?? null,
      toolCalls: (result.toolInputs ?? result.toolCalls.map((name) => ({ name, input: {} }))).map(
        ({ name, input }) => ({ name, input }),
      ),
      failures: result.failures,
    },
  };
}
