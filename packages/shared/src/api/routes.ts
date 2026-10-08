/** HTTP routes served by apps/api, shared so apps/web never hard-codes paths. */
export const API_ROUTES = {
  health: "/health",
  patients: "/patients",
  patientsImport: "/patients/import",
  patient: (patientId: string) => `/patients/${encodeURIComponent(patientId)}`,
  patientChat: (patientId: string) => `/patients/${encodeURIComponent(patientId)}/chat`,
  dashboardOverview: "/dashboards/overview",
  patientDashboard: (patientId: string) => `/dashboards/patients/${encodeURIComponent(patientId)}`,
} as const;
