import type { RecordChange } from "@health-mcp/shared";

/** Each field a change sets, with its old value struck through when it had one. */
export function RecordChanges({ changes, label }: { changes: RecordChange[]; label: string }) {
  return (
    <ul className="tool-call-output record-changes" aria-label={label}>
      {changes.map(({ field, before, after }) => (
        <li key={field}>
          <strong>{field}:</strong>{" "}
          {before !== undefined && (
            <>
              <del>{before}</del> →{" "}
            </>
          )}
          {after}
        </li>
      ))}
    </ul>
  );
}
