const patientPath = (patientId: string) => `/patients/${encodeURIComponent(patientId)}`;

/** HTTP routes served by apps/api, shared so apps/web never hard-codes paths. */
export const API_ROUTES = {
  health: "/health",
  patients: "/patients",
  patientsImport: "/patients/import",
  patient: patientPath,
  patientChat: (patientId: string) => `${patientPath(patientId)}/chat`,
  toolCallDecision: (patientId: string, toolCallId: string) =>
    `${patientPath(patientId)}/chat/tool-calls/${encodeURIComponent(toolCallId)}/decision`,
  dashboardOverview: "/dashboards/overview",
  patientDashboard: (patientId: string) => `/dashboards/patients/${encodeURIComponent(patientId)}`,
} as const;
