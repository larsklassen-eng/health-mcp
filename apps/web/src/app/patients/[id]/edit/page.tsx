import type { Patient } from "@health-mcp/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiUnavailableError } from "@/lib/api-client";

import { deletePatientAction, updatePatientAction } from "../../actions";
import { ApiUnavailable } from "../../api-unavailable";
import { PatientForm } from "../../patient-form";
import { DeletePatientButton } from "./delete-patient-button";

export const dynamic = "force-dynamic";

/** The form's values for a patient; missing optional fields are empty inputs. */
const formValues = (patient: Patient) => ({
  mrn: patient.mrn,
  firstName: patient.firstName,
  lastName: patient.lastName,
  dateOfBirth: patient.dateOfBirth,
  sex: patient.sex,
  status: patient.status,
  diagnosis: patient.diagnosis,
  surgeryDate: patient.surgeryDate ?? "",
  notes: patient.notes ?? "",
});

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let patient;
  try {
    patient = await api.getPatient(id);
  } catch (error) {
    if (error instanceof ApiUnavailableError) return <ApiUnavailable />;
    throw error;
  }
  if (!patient) notFound();

  const name = `${patient.firstName} ${patient.lastName}`;
  return (
    <>
      <p>
        <Link href={`/patients/${encodeURIComponent(patient.id)}`}>← {name}</Link>
      </p>
      <div className="page-header">
        <h1>Edit {name}</h1>
      </div>
      <PatientForm
        action={updatePatientAction.bind(null, patient.id)}
        initialValues={formValues(patient)}
        submitLabel="Save changes"
      />

      <section className="danger-zone card" aria-label="Delete patient">
        <h2>Delete patient</h2>
        <p className="muted">
          Deletes {name} together with their labs, vitals, medications, symptoms, milestones and
          chat history.
        </p>
        <DeletePatientButton
          action={deletePatientAction.bind(null, patient.id)}
          patientName={name}
        />
      </section>
    </>
  );
}
