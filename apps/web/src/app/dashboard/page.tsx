import type { DashboardOverview, PatientOverviewRow } from "@health-mcp/shared";
import Link from "next/link";

import { api, ApiUnavailableError } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/format";

import { ApiUnavailable } from "../patients/api-unavailable";
import { StatusBadge } from "../patients/patients-table";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let overview: DashboardOverview;
  try {
    overview = await api.getDashboardOverview();
  } catch (error) {
    if (error instanceof ApiUnavailableError) return <ApiUnavailable />;
    throw error;
  }

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <dl className="stats">
        <Stat label="Patients" value={overview.totalPatients} />
        <Stat label="Active patients" value={overview.activePatients} />
        <Stat
          label="Abnormal labs, last 7 days"
          value={overview.abnormalLabsLast7Days}
          warn={overview.abnormalLabsLast7Days > 0}
        />
      </dl>

      {overview.patients.length === 0 ? (
        <div className="card">
          <p>No patients yet.</p>
          <p className="muted">
            <Link href="/patients/import">Import a file of fake data</Link> to fill the dashboard.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Status</th>
                <th>Last activity</th>
                <th>Abnormal labs</th>
                <th>Active meds</th>
                <th>Pain</th>
                <th>Milestones</th>
              </tr>
            </thead>
            <tbody>
              {overview.patients.map((row) => (
                <OverviewRow key={row.patientId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={warn ? "stat warn" : "stat"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function OverviewRow({ row }: { row: PatientOverviewRow }) {
  return (
    <tr>
      <td>
        <Link href={`/patients/${encodeURIComponent(row.patientId)}/dashboard`}>{row.name}</Link>
        <div className="muted small">{row.mrn}</div>
      </td>
      <td>
        <StatusBadge status={row.status} />
      </td>
      <td>{row.lastActivityAt ? formatDate(row.lastActivityAt) : "—"}</td>
      <td>
        {row.abnormalLabCount > 0 ? (
          <span className="badge flag-high">{row.abnormalLabCount}</span>
        ) : (
          "0"
        )}
      </td>
      <td>{row.activeMedicationCount}</td>
      <td>{row.latestPainScore === null ? "—" : `${formatNumber(row.latestPainScore)}/10`}</td>
      <td>
        {row.milestonesTotal === 0 ? (
          "—"
        ) : (
          <span className="milestone-progress">
            <progress
              value={row.milestonesAchieved}
              max={row.milestonesTotal}
              aria-label={`${row.milestonesAchieved} of ${row.milestonesTotal} milestones achieved`}
            />
            {row.milestonesAchieved}/{row.milestonesTotal}
          </span>
        )}
      </td>
    </tr>
  );
}
