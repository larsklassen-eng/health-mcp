import type { RetrievalCaseInput } from "./retrieval-case.js";

/*
 * Retrieval checks for `search_patient_records`, on the synthetic patients in
 * fixtures/synthetic-patients.json. Most look for symptom notes, which no other
 * tool returns. Queries use different words than the text where a clinician
 * would, so meaning has to match, not only keywords. `test/retrieval-cases.test.ts`
 * checks that each relevant phrase is in that patient's data, and that each
 * other patient's phrase is not.
 *
 * Two splits. `tuning`: the first 19 checks, on which the chunk size, the
 * similarity cutoff and the reranker were chosen. `holdout`: added later and
 * never tuned on, so their scores are the honest ones. Tune on `tuning` only;
 * a change that helps `tuning` but not `holdout` is fitting the checks.
 */
export const RETRIEVAL_CASES: RetrievalCaseInput[] = [
  {
    id: "sleep-on-steroids",
    patientMrn: "FAKE-GBM-0001",
    query: "trouble sleeping",
    relevant: [
      { source: "symptom", textIncludes: "Trouble falling asleep while on dexamethasone" },
    ],
    split: "tuning",
  },
  {
    id: "nausea-after-chemo",
    patientMrn: "FAKE-GBM-0001",
    query: "nausea after chemotherapy",
    relevant: [{ source: "symptom", textIncludes: "an hour after temozolomide" }],
    split: "tuning",
  },
  {
    id: "radiation-skin",
    patientMrn: "FAKE-GBM-0001",
    query: "skin reaction to radiation",
    relevant: [{ source: "symptom", textIncludes: "Redness and itching over the radiation field" }],
    split: "tuning",
  },
  {
    id: "attention-problems",
    patientMrn: "FAKE-GBM-0001",
    query: "problems with attention or memory",
    relevant: [{ source: "symptom", textIncludes: "harder to follow long conversations" }],
    split: "tuning",
  },
  {
    id: "residual-tumor-report",
    patientMrn: "FAKE-GBM-0001",
    query: "was any tumor left after surgery",
    relevant: [{ source: "imaging_report", textIncludes: "No nodular enhancement to suggest" }],
    split: "tuning",
  },
  {
    id: "fine-motor-hand",
    patientMrn: "FAKE-AST-0004",
    query: "fine motor function of the right hand",
    relevant: [{ source: "symptom", textIncludes: "Can button shirts again" }],
    split: "tuning",
  },
  {
    id: "paresthesia",
    patientMrn: "FAKE-AST-0004",
    query: "paresthesia",
    relevant: [{ source: "symptom", textIncludes: "Pins and needles" }],
    split: "tuning",
  },
  {
    id: "osimertinib-gi-effects",
    patientMrn: "FAKE-MET-0005",
    query: "gastrointestinal side effects of osimertinib",
    relevant: [{ source: "symptom", textIncludes: "loose stools" }],
    split: "tuning",
  },
  {
    id: "vertigo",
    patientMrn: "FAKE-MET-0005",
    query: "vertigo",
    relevant: [{ source: "symptom", textIncludes: "Room spinning" }],
    split: "tuning",
  },
  {
    id: "lung-nodule",
    patientMrn: "FAKE-MET-0005",
    query: "lung nodule on chest imaging",
    relevant: [{ source: "imaging_report", textIncludes: "1.8 cm left upper lobe nodule" }],
    split: "tuning",
  },
  {
    id: "polyuria",
    patientMrn: "FAKE-PIT-0006",
    query: "polyuria and polydipsia",
    relevant: [{ source: "symptom", textIncludes: "Drinking over 5 liters" }],
    split: "tuning",
  },
  {
    id: "visual-fields",
    patientMrn: "FAKE-PIT-0006",
    query: "peripheral vision in daily life",
    relevant: [{ source: "symptom", textIncludes: "bumps into door frames" }],
    split: "tuning",
  },
  {
    id: "pathology-worry",
    patientMrn: "FAKE-MEN-0002",
    query: "anxious about the biopsy",
    relevant: [{ source: "symptom", textIncludes: "Worried about the pathology result" }],
    split: "tuning",
  },
  {
    id: "walking-aid",
    patientMrn: "FAKE-GBM-0007",
    query: "mobility aid",
    relevant: [{ source: "symptom", textIncludes: "Uses a walker outdoors" }],
    split: "tuning",
  },
  {
    id: "seizure-semiology",
    patientMrn: "FAKE-GBM-0007",
    query: "what did the seizure look like",
    relevant: [{ source: "symptom", textIncludes: "Right hand twitching" }],
    split: "tuning",
  },
  {
    id: "bruising",
    patientMrn: "FAKE-GBM-0008",
    query: "bleeding or bruising",
    relevant: [{ source: "symptom", textIncludes: "Small bruises on the shins" }],
    split: "tuning",
  },
  {
    id: "seizure-free-notes",
    patientMrn: "FAKE-OLI-0003",
    query: "any seizures since the operation",
    relevant: [{ source: "patient_notes", textIncludes: "Seizure-free since surgery" }],
    split: "tuning",
  },
  // Nothing in the records is relevant: the search should return nothing.
  {
    id: "off-topic-weather",
    patientMrn: "FAKE-GBM-0001",
    query: "what is the weather like",
    offTopic: true,
    split: "tuning",
  },
  {
    id: "off-topic-vacation",
    patientMrn: "FAKE-MEN-0002",
    query: "favorite beach holiday destination",
    offTopic: true,
    split: "tuning",
  },

  // ---------------------------------------------------------------- holdout
  // Several relevant passages: recall shows how many of them come back.
  {
    id: "radiotherapy-side-effects",
    patientMrn: "FAKE-GBM-0001",
    query: "side effects of radiotherapy",
    relevant: [
      { source: "symptom", textIncludes: "Redness and itching over the radiation field" },
      { source: "symptom", textIncludes: "Patchy hair loss over the treatment area" },
      { source: "symptom", textIncludes: "Tired in the afternoons since starting radiotherapy" },
    ],
    split: "holdout",
  },
  {
    id: "insomnia-course",
    patientMrn: "FAKE-GBM-0001",
    query: "insomnia and whether it resolved",
    relevant: [
      { source: "symptom", textIncludes: "Trouble falling asleep" },
      { source: "symptom", textIncludes: "Sleeping well since the steroid taper ended" },
    ],
    split: "holdout",
  },
  {
    id: "gait-aids",
    patientMrn: "FAKE-MET-0005",
    query: "balance and walking support",
    relevant: [
      { source: "symptom", textIncludes: "Needs a walker and supervision" },
      { source: "symptom", textIncludes: "Walks with a cane at home" },
    ],
    split: "holdout",
  },
  {
    id: "diabetes-insipidus-course",
    patientMrn: "FAKE-PIT-0006",
    query: "diabetes insipidus after surgery",
    relevant: [
      { source: "symptom", textIncludes: "Drinking over 5 liters" },
      { source: "symptom", textIncludes: "Normal thirst since stopping desmopressin" },
      { source: "patient_notes", textIncludes: "Transient diabetes insipidus" },
    ],
    split: "holdout",
  },
  {
    id: "hand-recovery",
    patientMrn: "FAKE-MEN-0002",
    query: "recovery of hand strength",
    relevant: [
      { source: "symptom", textIncludes: "Drops small objects" },
      { source: "symptom", textIncludes: "Occupational therapy exercises daily" },
      { source: "symptom", textIncludes: "Grip strength equal on both sides" },
    ],
    split: "holdout",
  },
  {
    id: "arm-sensation",
    patientMrn: "FAKE-AST-0004",
    query: "numbness or tingling in the arm",
    relevant: [
      { source: "symptom", textIncludes: "Pins and needles" },
      { source: "symptom", textIncludes: "Can button shirts again" },
    ],
    split: "holdout",
  },
  {
    id: "leg-weakness",
    patientMrn: "FAKE-GBM-0007",
    query: "weakness in the leg",
    relevant: [
      { source: "symptom", textIncludes: "Drags the right foot" },
      { source: "symptom", textIncludes: "Uses a walker outdoors" },
    ],
    split: "holdout",
  },
  {
    id: "recurrence-on-mri",
    patientMrn: "FAKE-GBM-0007",
    query: "signs of the tumor coming back",
    relevant: [
      { source: "imaging_report", textIncludes: "concerning for recurrence" },
      { source: "patient_notes", textIncludes: "new enhancement along the posterior cavity wall" },
    ],
    split: "holdout",
  },
  {
    id: "chemo-gi-effects",
    patientMrn: "FAKE-GBM-0008",
    query: "stomach and bowel problems during chemotherapy",
    relevant: [
      { source: "symptom", textIncludes: "Cycle 1, days 2-4" },
      { source: "symptom", textIncludes: "Related to ondansetron" },
    ],
    split: "holdout",
  },
  // One relevant passage.
  {
    id: "steroid-replacement",
    patientMrn: "FAKE-PIT-0006",
    query: "energy after starting steroid replacement",
    relevant: [{ source: "symptom", textIncludes: "Better after hydrocortisone was started" }],
    split: "holdout",
  },
  {
    id: "delayed-cycle",
    patientMrn: "FAKE-GBM-0008",
    query: "was chemotherapy postponed for low blood counts",
    relevant: [{ source: "patient_notes", textIncludes: "Cycle 4 was delayed one week" }],
    split: "holdout",
  },
  {
    id: "work-fatigue",
    patientMrn: "FAKE-OLI-0003",
    query: "tiredness related to his job",
    relevant: [{ source: "symptom", textIncludes: "Mostly after long work days" }],
    split: "holdout",
  },
  {
    id: "chronic-cough",
    patientMrn: "FAKE-MET-0005",
    query: "persistent cough",
    relevant: [{ source: "symptom", textIncludes: "Dry, unchanged for months" }],
    split: "holdout",
  },
  {
    id: "crossing-streets",
    patientMrn: "FAKE-GBM-0008",
    query: "how she copes with her vision loss outside",
    relevant: [{ source: "symptom", textIncludes: "uses head turns when crossing streets" }],
    split: "holdout",
  },
  // Off-topic: nothing should come back.
  {
    id: "off-topic-recipe",
    patientMrn: "FAKE-PIT-0006",
    query: "recipe for chocolate cake",
    offTopic: true,
    split: "holdout",
  },
  {
    id: "off-topic-car",
    patientMrn: "FAKE-OLI-0003",
    query: "renewing my car insurance",
    offTopic: true,
    split: "holdout",
  },
  {
    id: "off-topic-football",
    patientMrn: "FAKE-GBM-0007",
    query: "who won the football match last night",
    offTopic: true,
    split: "holdout",
  },
  // Patient isolation: the query matches another patient's records very well; their text
  // must never come back. (Every search is also checked for passages of other patients.)
  {
    id: "isolation-walker",
    patientMrn: "FAKE-GBM-0001",
    query: "uses a walker outdoors",
    otherPatientText: ["Uses a walker outdoors", "Needs a walker and supervision"],
    split: "holdout",
  },
  {
    id: "isolation-thirst",
    patientMrn: "FAKE-MEN-0002",
    query: "drinking over 5 liters a day",
    otherPatientText: ["Drinking over 5 liters"],
    split: "holdout",
  },
  {
    id: "isolation-osimertinib",
    patientMrn: "FAKE-AST-0004",
    query: "loose stools from osimertinib",
    otherPatientText: ["loose stools", "osimertinib"],
    split: "holdout",
  },
  {
    id: "isolation-seizure",
    patientMrn: "FAKE-PIT-0006",
    query: "right hand twitching seizure",
    otherPatientText: ["Right hand twitching"],
    split: "holdout",
  },
];
