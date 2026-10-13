import Link from "next/link";

import { api, ApiUnavailableError } from "@/lib/api-client";

import { ApiUnavailable } from "./api-unavailable";

import { PatientsTable } from "./patients-table";

// Always render with fresh data from the api (never prerendered at build time).
export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  let patients;
  try {
    patients = await api.listPatients();
  } catch (error) {
    if (error instanceof ApiUnavailableError) return <ApiUnavailable />;
    throw error;
  }

  return (
    <>
      <div className="page-header">
        <h1>Patients</h1>
        <div className="actions">
          <Link href="/patients/import" className="button secondary">
            Import
          </Link>
          <Link href="/patients/new" className="button">
            New patient
          </Link>
        </div>
      </div>
      <PatientsTable patients={patients} />
    </>
  );
}
