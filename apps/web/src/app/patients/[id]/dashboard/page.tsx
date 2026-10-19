import type {
  LabResult,
  Medication,
  PatientDashboard,
  RecoveryMilestone,
  Symptom,
  VitalSign,
  VitalTrend,
} from "@health-mcp/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { api, ApiUnavailableError } from "@/lib/api-client";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  isAbnormalFlag,
  modalityLabel,
  seriesSummary,
  VITAL_LABELS,
} from "@/lib/format";

import { ApiUnavailable } from "../../api-unavailable";
import { StatusBadge } from "../../patients-table";
import { Sparkline } from "./sparkline";

export const dynamic = "force-dynamic";

export default async function PatientDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let dashboard: PatientDashboard | null;
  try {
    dashboard = await api.getPatientDashboard(id);
  } catch (error) {
    if (error instanceof ApiUnavailableError) return <ApiUnavailable />;
    throw error;
  }
  if (!dashboard) notFound();

  const { patient } = dashboard;
  const patientPath = `/patients/${encodeURIComponent(patient.id)}`;

  return (
    <>
      <p>
        <Link href="/dashboard">← Dashboard</Link>
      </p>
      <div className="page-header">
        <div>
          <div className="title-row">
            <h1>
              {patient.firstName} {patient.lastName}
            </h1>
            <StatusBadge status={patient.status} />
          </div>
          <p className="muted subtitle">
            {patient.mrn} · {patient.diagnosis}
            {patient.surgeryDate && ` · Surgery ${formatDate(patient.surgeryDate)}`}
          </p>
        </div>
        <div className="actions">
          <Link className="button secondary" href={patientPath}>
            Profile
          </Link>
          <Link className="button" href={`${patientPath}/chat`}>
            Chat
          </Link>
        </div>
      </div>

      <Section title="Vitals" empty={dashboard.latestVitals.length === 0 && "No vitals recorded."}>
        <Vitals latest={dashboard.latestVitals} trends={dashboard.vitalTrends} />
      </Section>
      <Section title="Labs" empty={dashboard.recentLabs.length === 0 && "No lab results."}>
        <Labs labs={dashboard.recentLabs} />
      </Section>
      <div className="columns">
        <Section
          title="Active medications"
          empty={dashboard.activeMedications.length === 0 && "No active medications."}
        >
          <Medications medications={dashboard.activeMedications} />
        </Section>
        <Section
          title="Recent symptoms"
          empty={dashboard.recentSymptoms.length === 0 && "No symptoms recorded."}
        >
          <Symptoms symptoms={dashboard.recentSymptoms} />
        </Section>
      </div>
      <Section
        title="Recovery milestones"
        empty={dashboard.milestones.length === 0 && "No milestones."}
      >
        <Milestones milestones={dashboard.milestones} />
      </Section>
      <Section
        title="Imaging"
        empty={dashboard.imagingStudies.length === 0 && "No imaging studies."}
      >
        <Imaging patientPath={patientPath} studies={dashboard.imagingStudies} />
      </Section>
      <p>
        <Link className="button secondary" href={`${patientPath}/imaging/upload`}>
          Upload DICOM images
        </Link>
      </p>
    </>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  /** Shown instead of the children when set. */
  empty: string | false;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-section" aria-label={title}>
      <h2>{title}</h2>
      {empty ? <p className="muted card">{empty}</p> : children}
    </section>
  );
}

function Vitals({ latest, trends }: { latest: VitalSign[]; trends: VitalTrend[] }) {
  return (
    <ul className="vitals">
      {latest.map((vital) => {
        const trend = trends.find((t) => t.type === vital.type);
        return (
          <li key={vital.type} className="vital card">
            <div className="vital-label">{VITAL_LABELS[vital.type]}</div>
            <div className="vital-value">
              {formatNumber(vital.value)} <span className="muted">{vital.unit}</span>
            </div>
            {trend && <Sparkline points={trend.points} unit={trend.unit} />}
            <div className="muted small">{formatDateTime(vital.recordedAt)}</div>
          </li>
        );
      })}
    </ul>
  );
}

function referenceRange({ referenceLow: low, referenceHigh: high }: LabResult): string {
  if (low !== undefined && high !== undefined) {
    return `${formatNumber(low)}–${formatNumber(high)}`;
  }
  if (low !== undefined) return `≥ ${formatNumber(low)}`;
  if (high !== undefined) return `≤ ${formatNumber(high)}`;
  return "—";
}

function Labs({ labs }: { labs: LabResult[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Result</th>
            <th>Reference</th>
            <th>Flag</th>
            <th>Collected</th>
          </tr>
        </thead>
        <tbody>
          {labs.map((lab) => (
            <tr key={lab.id} className={isAbnormalFlag(lab.flag) ? "abnormal" : undefined}>
              <td>{lab.testName}</td>
              <td>
                {formatNumber(lab.value)} <span className="muted">{lab.unit}</span>
              </td>
              <td>{referenceRange(lab)}</td>
              <td>
                {lab.flag ? <span className={`badge flag-${lab.flag}`}>{lab.flag}</span> : "—"}
              </td>
              <td>{formatDate(lab.collectedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Medications({ medications }: { medications: Medication[] }) {
  return (
    <ul className="record-list card">
      {medications.map((medication) => (
        <li key={medication.id}>
          <strong>{medication.name}</strong> {medication.dosage}, {medication.frequency}
          {medication.route && ` (${medication.route})`}
          <div className="muted small">Since {formatDate(medication.startDate)}</div>
        </li>
      ))}
    </ul>
  );
}

function Symptoms({ symptoms }: { symptoms: Symptom[] }) {
  return (
    <ul className="record-list card">
      {symptoms.map((symptom) => (
        <li key={symptom.id}>
          <strong>{symptom.name}</strong>{" "}
          <span className="muted">severity {symptom.severity}/10</span>
          {symptom.notes && <div>{symptom.notes}</div>}
          <div className="muted small">{formatDateTime(symptom.recordedAt)}</div>
        </li>
      ))}
    </ul>
  );
}

function Milestones({ milestones }: { milestones: RecoveryMilestone[] }) {
  return (
    <ul className="record-list card">
      {milestones.map((milestone) => (
        <li key={milestone.id}>
          <span className={`badge milestone-${milestone.status}`}>{milestone.status}</span>{" "}
          <strong>{milestone.title}</strong>
          {milestone.description && <div>{milestone.description}</div>}
          <div className="muted small">
            {milestone.achievedAt
              ? `Achieved ${formatDate(milestone.achievedAt)}`
              : milestone.targetDate
                ? `Target ${formatDate(milestone.targetDate)}`
                : "No target date"}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Imaging({
  patientPath,
  studies,
}: {
  patientPath: string;
  studies: PatientDashboard["imagingStudies"];
}) {
  return (
    <ul className="record-list card">
      {studies.map((study) => (
        <li key={study.id}>
          <Link href={`${patientPath}/imaging/${encodeURIComponent(study.id)}`}>
            <strong>
              {modalityLabel(study.modality)}
              {study.bodyPart && ` ${study.bodyPart.toLowerCase()}`}
            </strong>
          </Link>{" "}
          <span className="muted">
            {formatDate(study.studyDate)}
            {study.description && ` · ${study.description}`}
          </span>
          {study.impression && <div>{study.impression}</div>}
          <div className="muted small">
            {study.series.length > 0 ? seriesSummary(study.series) : "Report only, no images"}
          </div>
        </li>
      ))}
    </ul>
  );
}
