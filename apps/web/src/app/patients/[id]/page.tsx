import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiUnavailableError } from "@/lib/api-client";

import { ApiUnavailable } from "../api-unavailable";

import { StatusBadge } from "../patients-table";
import { patientAccessAction } from "./access-actions";
import { PatientAccess } from "./patient-access";

export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let patient, session;
  try {
    [patient, session] = await Promise.all([api.getPatient(id), api.getSession()]);
  } catch (error) {
    if (error instanceof ApiUnavailableError) return <ApiUnavailable />;
    throw error;
  }
  if (!patient) notFound();
  // Patient accounts exist only with sign-in; doctors manage them.
  const managesAccess = session.mode === "password" && session.user?.role === "doctor";
  const account = managesAccess ? await api.getPatientAccount(id) : null;

  const rows: [string, React.ReactNode][] = [
    ["MRN", patient.mrn],
    ["Date of birth", patient.dateOfBirth],
    ["Sex", patient.sex],
    ["Status", <StatusBadge key="status" status={patient.status} />],
    ["Diagnosis", patient.diagnosis],
    ["Surgery date", patient.surgeryDate ?? "—"],
    ["Notes", patient.notes ?? "—"],
  ];

  return (
    <>
      <p>
        <Link href="/patients">← All patients</Link>
      </p>
      <div className="page-header">
        <h1>
          {patient.firstName} {patient.lastName}
        </h1>
        <div className="actions">
          <Link
            className="button secondary"
            href={`/patients/${encodeURIComponent(patient.id)}/edit`}
          >
            Edit
          </Link>
          <Link
            className="button secondary"
            href={`/patients/${encodeURIComponent(patient.id)}/dashboard`}
          >
            Dashboard
          </Link>
          <Link className="button" href={`/patients/${encodeURIComponent(patient.id)}/chat`}>
            Chat
          </Link>
        </div>
      </div>
      <dl className="profile card">
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {managesAccess && (
        <PatientAccess
          account={account}
          patient={{ firstName: patient.firstName, lastName: patient.lastName }}
          action={patientAccessAction.bind(null, patient.id)}
        />
      )}
    </>
  );
}
