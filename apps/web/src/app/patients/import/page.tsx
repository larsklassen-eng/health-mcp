import { importPatientsAction } from "../actions";
import { ImportPatientsForm } from "../import-patients-form";

const EXAMPLE = `{
  "version": 1,
  "patients": [
    {
      "patient": {
        "mrn": "FAKE-001", "firstName": "Ana", "lastName": "Test",
        "dateOfBirth": "1980-01-01", "sex": "female", "diagnosis": "Synthetic meningioma"
      },
      "labResults": [
        { "testName": "Hemoglobin", "value": 11.2, "unit": "g/dL", "flag": "low",
          "collectedAt": "2026-09-10T08:00:00Z" }
      ]
    }
  ]
}`;

export default function ImportPatientsPage() {
  return (
    <>
      <div className="page-header">
        <h1>Import patients</h1>
      </div>
      <p className="muted">
        Upload a JSON file of <strong>synthetic</strong> patients. Each patient can include lab results, vitals,
        medications, symptoms and milestones. The import is all-or-nothing: if any patient fails, nothing is saved.
      </p>
      <ImportPatientsForm action={importPatientsAction} />
      <details className="card" style={{ marginTop: 24 }}>
        <summary>File format example</summary>
        <pre>{EXAMPLE}</pre>
      </details>
    </>
  );
}
