import type { RecordPassage, RecordSearchOutput } from "@health-mcp/shared";
import Link from "next/link";

import { messageAnchor, symptomAnchor } from "@/lib/anchors";

/** Where the record a passage comes from is shown in the app. */
export function sourceHref(patientId: string, passage: RecordPassage): string {
  const patient = `/patients/${encodeURIComponent(patientId)}`;
  const id = encodeURIComponent(passage.sourceId);
  switch (passage.source) {
    case "imaging_report":
      return `${patient}/imaging/${id}`;
    case "patient_notes":
      return patient;
    // The dashboard lists the latest symptoms; for an older one the link opens its top.
    case "symptom":
      return `${patient}/dashboard#${symptomAnchor(id)}`;
    // Earlier messages are in the same transcript.
    case "chat_message":
      return `#${messageAnchor(id)}`;
  }
}

const MATCH_LABELS = {
  vector: "by meaning",
  keyword: "by keywords",
  both: "by meaning and keywords",
} as const;

/** E.g. "similarity 0.82 · by meaning and keywords". */
export function matchLabel(passage: RecordPassage): string {
  const how = passage.matchedBy.length > 1 ? "both" : (passage.matchedBy[0] ?? "vector");
  return [
    passage.similarity !== undefined && `similarity ${passage.similarity.toFixed(2)}`,
    MATCH_LABELS[how],
  ]
    .filter(Boolean)
    .join(" · ");
}

interface Props {
  patientId: string;
  output: RecordSearchOutput;
}

/** The passages `search_patient_records` found, each with a link to its source. */
export function RecordSearchResults({ patientId, output }: Props) {
  if (output.passages.length === 0)
    return <p className="muted tool-call-output">{output.note ?? "No passages were found."}</p>;

  return (
    <ol className="tool-call-output record-passages" aria-label="Passages found">
      {output.passages.map((passage, index) => (
        <li key={`${passage.source}-${passage.sourceId}-${index}`}>
          <div className="record-passage-meta">
            <Link href={sourceHref(patientId, passage)}>{passage.title}</Link>
            <span className="muted">{matchLabel(passage)}</span>
          </div>
          <blockquote>{passage.text}</blockquote>
        </li>
      ))}
    </ol>
  );
}
