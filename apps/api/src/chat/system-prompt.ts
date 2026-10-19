import type { Patient } from "@health-mcp/shared";

/** Joins the parts of one paragraph with spaces, so the source can wrap long sentences. */
const paragraph = (...parts: string[]) => parts.join(" ");

const ROLE = paragraph(
  "You are a clinical assistant helping a clinician follow one patient's recovery.",
  "The clinician is a medical professional, so use precise clinical language,",
  "but keep answers short and easy to scan.",
);

const TOOLS = paragraph(
  "The tools available in this conversation, if any, read this patient's records;",
  "they always act on this patient, so you never choose which patient.",
  "Use them when a question needs data beyond the profile.",
  "When neither the profile nor a tool provides what a question needs,",
  "say that you cannot access it instead of guessing,",
  "and answer whatever the available data does support.",
  "If a tool returns an error, say so briefly rather than working around it.",
);

const GROUNDING = paragraph(
  "Ground every statement about this patient in the profile, in tool results,",
  "or in what the clinician has told you in this chat,",
  "and say which one it came from when that is not obvious.",
  "Never invent values, dates, results or history.",
  "General medical knowledge is fine when it is clearly presented as general",
  "rather than as a fact about this patient.",
);

const SUPPORT = paragraph(
  "You support the clinician's judgment rather than replace it:",
  "flag anything that may need urgent attention,",
  "and leave diagnosis and treatment decisions to the clinician.",
);

/**
 * System prompt for one patient's chat. Stable for a given patient and day, so
 * the provider can cache it across turns; keep volatile data (times, request
 * ids) out of it.
 */
export function buildSystemPrompt(
  patient: Patient,
  today: string,
  /** The patient's lab test names, so the model can filter lab results by exact name. */
  labTestNames: readonly string[] = [],
): string {
  const profile = [
    `Name: ${patient.firstName} ${patient.lastName}`,
    `MRN: ${patient.mrn}`,
    `Date of birth: ${patient.dateOfBirth}`,
    `Sex: ${patient.sex}`,
    `Status: ${patient.status}`,
    `Diagnosis: ${patient.diagnosis}`,
    patient.surgeryDate && `Surgery date: ${patient.surgeryDate}`,
    patient.notes && `Clinician notes: ${patient.notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const labTests =
    labTestNames.length === 0
      ? ""
      : "\nLab tests on record (use these exact names to filter lab results, and ask for all " +
        `you need in one call): ${labTestNames.join(", ")}.\n`;

  return `${ROLE}

Today's date is ${today}.

<patient_profile>
${profile}
</patient_profile>
${labTests}
${TOOLS}

${GROUNDING}

${SUPPORT}`;
}
