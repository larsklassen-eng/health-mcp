import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiUnavailableError } from "@/lib/api-client";
import { formatDate, modalityLabel, seriesSummary } from "@/lib/format";

import { ApiUnavailable } from "../../../api-unavailable";
import { deleteImagingStudyAction, updateImagingStudyAction } from "../actions";
import { DeleteStudyButton } from "./delete-study-button";
import { ImageViewer } from "./image-viewer";
import { StudyReportForm } from "./study-report-form";

export const dynamic = "force-dynamic";

export default async function ImagingStudyPage({
  params,
}: {
  params: Promise<{ id: string; studyId: string }>;
}) {
  const { id, studyId } = await params;
  let patient, study;
  try {
    [patient, study] = await Promise.all([api.getPatient(id), api.getImagingStudy(id, studyId)]);
  } catch (error) {
    if (error instanceof ApiUnavailableError) return <ApiUnavailable />;
    throw error;
  }
  if (!patient || !study) notFound();

  const dashboardPath = `/patients/${encodeURIComponent(patient.id)}/dashboard`;
  const bodyPart = study.bodyPart ? ` ${study.bodyPart.toLowerCase()}` : "";
  const title = `${modalityLabel(study.modality)}${bodyPart}`;
  return (
    <>
      <p>
        <Link href={dashboardPath}>
          ← {patient.firstName} {patient.lastName}
        </Link>
      </p>
      <div className="page-header">
        <div>
          <h1>
            {title}, {formatDate(study.studyDate)}
          </h1>
          <p className="muted subtitle">
            {study.description && `${study.description} · `}
            {study.series.length > 0 ? seriesSummary(study.series) : "Report only, no images"}
            {study.source === "dicom" ? " · uploaded DICOM" : " · imported"}
          </p>
        </div>
      </div>

      {study.series.length > 0 && (
        <section className="dashboard-section" aria-label="Images">
          <h2>Images</h2>
          <ImageViewer patientId={patient.id} studyId={study.id} series={study.series} />
        </section>
      )}

      <section className="dashboard-section" aria-label="Report">
        <h2>Report</h2>
        <StudyReportForm
          action={updateImagingStudyAction.bind(null, patient.id, study.id)}
          initial={{
            ...(study.description && { description: study.description }),
            ...(study.impression && { impression: study.impression }),
            ...(study.report && { report: study.report }),
          }}
        />
      </section>

      <section className="danger-zone card" aria-label="Delete study">
        <h2>Delete study</h2>
        <p className="muted">Deletes the study with its report and images.</p>
        <DeleteStudyButton action={deleteImagingStudyAction.bind(null, patient.id, study.id)} />
      </section>
    </>
  );
}
