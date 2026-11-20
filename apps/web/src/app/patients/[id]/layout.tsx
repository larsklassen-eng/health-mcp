import type { Metadata } from "next";

import { api } from "@/lib/api-client";

/**
 * Titles a patient's pages with the patient's name, e.g. "Chat · Ana Test ·
 * Health MCP". The pages load the patient themselves and show any error.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const patient = await api.getPatient(id).catch(() => undefined);
  if (!patient) return {};
  const name = `${patient.firstName} ${patient.lastName}`;
  return { title: { default: name, template: `%s · ${name} · Health MCP` } };
}

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return children;
}
