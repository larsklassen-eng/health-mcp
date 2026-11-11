import { loadEnvFile } from "@health-mcp/db";

import { CASES } from "./cases.js";
import { EvalCaseSchema } from "./eval-case.js";
import { judgeFromEnv } from "./judge.js";
import { JUDGE_LABELS } from "./judge-labels.js";
import { formatUsage, sumUsage } from "./usage.js";

/*
 * Checks the judge against answers labeled by a person (judge-labels.ts): how
 * often it agrees, and where it does not. Calls the judge model once per label,
 * so it costs a little. Usage: `yarn eval:judge`.
 */

async function main(): Promise<number> {
  loadEnvFile();
  const created = judgeFromEnv();
  if (typeof created === "string") {
    console.error(created);
    return 2;
  }
  const { judge, model } = created;
  const cases = new Map(CASES.map((input) => EvalCaseSchema.parse(input)).map((c) => [c.id, c]));
  console.log(`Checking ${JUDGE_LABELS.length} labeled answers with ${model}.\n`);

  let agreed = 0;
  let total = 0;
  const usages = [];
  for (const label of JUDGE_LABELS) {
    const evalCase = cases.get(label.caseId);
    if (!evalCase) throw new Error(`${label.id}: no case ${label.caseId}`);
    const { verdicts, usage } = await judge({
      question: evalCase.userMessage,
      answer: label.answer,
      toolResults: [],
      criteria: evalCase.rubric,
    });
    usages.push(usage);
    for (const [i, verdict] of verdicts.entries()) {
      total += 1;
      const expected = label.met[i];
      if (verdict.met === expected) {
        agreed += 1;
        console.log(`✓ ${label.id}: ${verdict.met ? "met" : "not met"}`);
      } else {
        console.log(`✗ ${label.id}: the judge says ${verdict.met ? "met" : "not met"}`);
        console.log(`    "${verdict.criterion}"`);
        console.log(`    Judge: ${verdict.reason}`);
        console.log(`    Label: ${label.note}`);
      }
    }
  }

  const percent = total === 0 ? 0 : Math.round((agreed / total) * 100);
  console.log(`\nAgreed on ${agreed}/${total} verdicts (${percent}%).`);
  console.log(`Total: ${formatUsage(sumUsage(usages))}.`);
  return agreed === total ? 0 : 1;
}

process.exitCode = await main();
