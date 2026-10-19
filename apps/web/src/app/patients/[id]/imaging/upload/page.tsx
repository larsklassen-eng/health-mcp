import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiUnavailableError } from "@/lib/api-client";

import { ApiUnavailable } from "../../../api-unavailable";
import { DicomUploadForm } from "./dicom-upload-form";

export const dynamic = "force-dynamic";

export default async function DicomUploadPage({ params }: { params: Promise<{ id: string }> }) {
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
        <Link href={`/patients/${encodeURIComponent(patient.id)}/dashboard`}>← {name}</Link>
      </p>
      <div className="page-header">
        <h1>Upload DICOM images for {name}</h1>
      </div>
      <p className="muted">
        The studies are added to this patient. Only the images and technical details (type, date,
        series) are kept; names, birth dates and IDs inside the files are ignored. Reports are not
        part of DICOM files: add them on the study page.
      </p>
      <DicomUploadForm patientId={patient.id} />
    </>
  );
}
