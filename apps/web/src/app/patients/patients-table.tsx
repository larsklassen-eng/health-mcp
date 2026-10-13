import type { PatientSummary } from "@health-mcp/shared";
import Link from "next/link";

export function StatusBadge({ status }: { status: PatientSummary["status"] }) {
  return <span className={status === "active" ? "badge" : "badge inactive"}>{status}</span>;
}

export function PatientsTable({ patients }: { patients: PatientSummary[] }) {
  if (patients.length === 0) {
    return (
      <div className="card">
        <p>No patients yet.</p>
        <p className="muted">
          <Link href="/patients/new">Add a patient</Link> or <Link href="/patients/import">import a file of fake data</Link>.
        </p>
      </div>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>MRN</th>
          <th>Diagnosis</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {patients.map((patient) => (
          <tr key={patient.id}>
            <td>
              <Link href={`/patients/${encodeURIComponent(patient.id)}`}>
                {patient.lastName}, {patient.firstName}
              </Link>
            </td>
            <td>{patient.mrn}</td>
            <td>{patient.diagnosis}</td>
            <td>
              <StatusBadge status={patient.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
