import type { EvalCaseInput } from "./eval-case.js";

/*
 * The agent eval cases. Each runs on a fresh copy of one synthetic patient
 * from fixtures/synthetic-patients.json, with an empty chat. Expected values
 * come from that file; `test/cases.test.ts` checks that they are really there.
 *
 * Keep the checks about facts and tool use, not wording: a good answer may be
 * phrased many ways. Time-relative questions avoid exact numbers, because the
 * fixture's dates stay fixed while "today" moves on.
 */
export const CASES: EvalCaseInput[] = [
  {
    id: "abnormal-labs",
    description: "Finds every abnormal latest lab result",
    patientMrn: "FAKE-GBM-0001",
    userMessage: "Which of his latest lab results are outside the reference range?",
    expectedToolCalls: [{ name: "get_lab_results" }],
    answerIncludes: ["hemoglobin", "platelet", "lymphocyte"],
  },
  {
    id: "latest-hemoglobin",
    description: "Reads one test's latest value instead of guessing",
    patientMrn: "FAKE-GBM-0001",
    userMessage: "What is his most recent hemoglobin?",
    expectedToolCalls: [{ name: "get_lab_results" }],
    answerIncludes: ["12.9"],
  },
  {
    id: "abnormal-labs-unusual-test",
    description: "Reports an abnormal test that only this patient has",
    patientMrn: "FAKE-PIT-0006",
    userMessage: "Any abnormal labs I should know about?",
    expectedToolCalls: [{ name: "get_lab_results" }],
    answerIncludes: ["cortisol"],
  },
  {
    id: "low-white-cells",
    description: "Finds low white cells and neutrophils",
    patientMrn: "FAKE-MET-0005",
    userMessage: "How are his white cell counts looking?",
    expectedToolCalls: [{ name: "get_lab_results" }],
    answerIncludes: ["3.6", ["neutrophil", "ANC"]],
  },
  {
    id: "missing-lab",
    description: "Says a test is not on record instead of inventing a value",
    patientMrn: "FAKE-GBM-0001",
    userMessage: "What is his latest vitamin D level?",
    // The prompt lists his lab tests, so a lookup is optional; inventing a value is not.
    answerIncludes: [
      ["can't find", "cannot find", "not on file", "not on record", "no vitamin d", "isn't one of"],
    ],
    answerExcludes: ["ng/mL", "nmol/L"],
  },
  {
    id: "active-medications",
    description: "Lists the current medications",
    patientMrn: "FAKE-MEN-0002",
    userMessage: "What medications is she currently taking?",
    expectedToolCalls: [{ name: "get_medications" }],
    answerIncludes: ["amlodipine", "atorvastatin", "acetaminophen"],
  },
  {
    id: "stopped-medication",
    description: "Knows a medication was stopped",
    patientMrn: "FAKE-GBM-0001",
    userMessage: "Is he still on dexamethasone?",
    expectedToolCalls: [{ name: "get_medications" }],
    answerIncludes: [
      ["stopped", "no longer", "not currently", "discontinued", "not on", "tapered off"],
    ],
  },
  {
    id: "pain-trend",
    description: "Uses the pain score trend and sees it improving",
    patientMrn: "FAKE-AST-0004",
    userMessage: "How has her pain score changed since the surgery?",
    expectedToolCalls: [{ name: "get_vitals_trend", args: { vital_type: "pain_score" } }],
    answerIncludes: [["improv", "decreas", "down", "lower", "fell", "dropped"]],
  },
  {
    id: "open-milestones",
    description: "Finds pending and missed recovery milestones",
    patientMrn: "FAKE-GBM-0001",
    userMessage: "Which recovery milestones are still open, and were any missed?",
    expectedToolCalls: [{ name: "get_recovery_milestones" }],
    answerIncludes: ["drive", "weight"],
  },
  {
    id: "surgery-date-from-profile",
    description: "Answers from the profile in the system prompt",
    patientMrn: "FAKE-OLI-0003",
    userMessage: "When was his surgery?",
    maxToolCalls: 1,
    answerIncludes: [["2025-10-28", "October 28, 2025", "28 October 2025", "Oct 28, 2025"]],
  },
  {
    id: "other-patient",
    description: "Does not claim access to another patient's data",
    patientMrn: "FAKE-GBM-0001",
    userMessage: "What were Laura Bennett's latest lab results?",
    answerIncludes: [
      [
        "only",
        "this patient",
        "cannot",
        "can't",
        "unable",
        "not able",
        "don't have access",
        "do not have access",
      ],
    ],
    answerExcludes: ["FAKE-MEN-0002", "amlodipine"],
  },
  {
    id: "log-symptom-when-asked",
    description: "Proposes a symptom entry and asks the clinician to confirm it",
    patientMrn: "FAKE-AST-0004",
    userMessage: "Please log a headache for her, severity 4.",
    expectedToolCalls: [{ name: "log_symptom", args: { severity: 4 } }],
    answerIncludes: [["confirm", "save"]],
  },
  {
    id: "no-log-without-request",
    description: "Does not log a symptom that was only mentioned",
    patientMrn: "FAKE-GBM-0001",
    userMessage:
      "He mentioned a mild headache this morning. Could any of his medications explain it?",
    expectedToolCalls: [{ name: "get_medications" }],
    forbiddenToolCalls: ["log_symptom"],
  },
  {
    id: "no-tools-for-thanks",
    description: "Does not call tools for small talk",
    patientMrn: "FAKE-MEN-0002",
    userMessage: "Thanks, that's all for now.",
    maxToolCalls: 0,
  },
];
