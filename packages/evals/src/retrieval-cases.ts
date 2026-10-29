import type { RetrievalCaseInput } from "./retrieval-case.js";

/*
 * Retrieval checks for `search_patient_records`, on the synthetic patients in
 * fixtures/synthetic-patients.json. Most look for symptom notes, which no other
 * tool returns. Queries use different words than the text where a clinician
 * would, so meaning has to match, not only keywords. `test/retrieval-cases.test.ts`
 * checks that each expected phrase is in that patient's data.
 */
export const RETRIEVAL_CASES: RetrievalCaseInput[] = [
  {
    id: "sleep-on-steroids",
    patientMrn: "FAKE-GBM-0001",
    query: "trouble sleeping",
    expected: { source: "symptom", textIncludes: "Trouble falling asleep while on dexamethasone" },
  },
  {
    id: "nausea-after-chemo",
    patientMrn: "FAKE-GBM-0001",
    query: "nausea after chemotherapy",
    expected: { source: "symptom", textIncludes: "an hour after temozolomide" },
  },
  {
    id: "radiation-skin",
    patientMrn: "FAKE-GBM-0001",
    query: "skin reaction to radiation",
    expected: { source: "symptom", textIncludes: "Redness and itching over the radiation field" },
  },
  {
    id: "attention-problems",
    patientMrn: "FAKE-GBM-0001",
    query: "problems with attention or memory",
    expected: { source: "symptom", textIncludes: "harder to follow long conversations" },
  },
  {
    id: "residual-tumor-report",
    patientMrn: "FAKE-GBM-0001",
    query: "was any tumor left after surgery",
    expected: { source: "imaging_report", textIncludes: "No nodular enhancement to suggest" },
  },
  {
    id: "fine-motor-hand",
    patientMrn: "FAKE-AST-0004",
    query: "fine motor function of the right hand",
    expected: { source: "symptom", textIncludes: "Can button shirts again" },
  },
  {
    id: "paresthesia",
    patientMrn: "FAKE-AST-0004",
    query: "paresthesia",
    expected: { source: "symptom", textIncludes: "Pins and needles" },
  },
  {
    id: "osimertinib-gi-effects",
    patientMrn: "FAKE-MET-0005",
    query: "gastrointestinal side effects of osimertinib",
    expected: { source: "symptom", textIncludes: "loose stools" },
  },
  {
    id: "vertigo",
    patientMrn: "FAKE-MET-0005",
    query: "vertigo",
    expected: { source: "symptom", textIncludes: "Room spinning" },
  },
  {
    id: "lung-nodule",
    patientMrn: "FAKE-MET-0005",
    query: "lung nodule on chest imaging",
    expected: { source: "imaging_report", textIncludes: "1.8 cm left upper lobe nodule" },
  },
  {
    id: "polyuria",
    patientMrn: "FAKE-PIT-0006",
    query: "polyuria and polydipsia",
    expected: { source: "symptom", textIncludes: "Drinking over 5 liters" },
  },
  {
    id: "visual-fields",
    patientMrn: "FAKE-PIT-0006",
    query: "peripheral vision in daily life",
    expected: { source: "symptom", textIncludes: "bumps into door frames" },
  },
  {
    id: "pathology-worry",
    patientMrn: "FAKE-MEN-0002",
    query: "anxious about the biopsy",
    expected: { source: "symptom", textIncludes: "Worried about the pathology result" },
  },
  {
    id: "walking-aid",
    patientMrn: "FAKE-GBM-0007",
    query: "mobility aid",
    expected: { source: "symptom", textIncludes: "Uses a walker outdoors" },
  },
  {
    id: "seizure-semiology",
    patientMrn: "FAKE-GBM-0007",
    query: "what did the seizure look like",
    expected: { source: "symptom", textIncludes: "Right hand twitching" },
  },
  {
    id: "bruising",
    patientMrn: "FAKE-GBM-0008",
    query: "bleeding or bruising",
    expected: { source: "symptom", textIncludes: "Small bruises on the shins" },
  },
  {
    id: "seizure-free-notes",
    patientMrn: "FAKE-OLI-0003",
    query: "any seizures since the operation",
    expected: { source: "patient_notes", textIncludes: "Seizure-free since surgery" },
  },
  // Nothing in the records is relevant: the search should return nothing.
  { id: "off-topic-weather", patientMrn: "FAKE-GBM-0001", query: "what is the weather like" },
  {
    id: "off-topic-vacation",
    patientMrn: "FAKE-MEN-0002",
    query: "favorite beach holiday destination",
  },
];
