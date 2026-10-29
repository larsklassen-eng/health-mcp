const patientPath = (patientId: string) => `/patients/${encodeURIComponent(patientId)}`;

/** HTTP routes served by apps/api, shared so apps/web never hard-codes paths. */
export const API_ROUTES = {
  health: "/health",
  authGoogleStart: "/auth/google/start",
  authGoogleCallback: "/auth/google/callback",
  authSession: "/auth/session",
  patients: "/patients",
  patientsImport: "/patients/import",
  patient: patientPath,
  patientChat: (patientId: string) => `${patientPath(patientId)}/chat`,
  toolCallDecision: (patientId: string, toolCallId: string) =>
    `${patientPath(patientId)}/chat/tool-calls/${encodeURIComponent(toolCallId)}/decision`,
  patientImaging: (patientId: string) => `${patientPath(patientId)}/imaging`,
  imagingStudy: (patientId: string, studyId: string) =>
    `${patientPath(patientId)}/imaging/${encodeURIComponent(studyId)}`,
  dicomUpload: (patientId: string) => `${patientPath(patientId)}/imaging/dicom`,
  imagingImage: (patientId: string, studyId: string, seriesId: string, position: number) =>
    `${patientPath(patientId)}/imaging/${encodeURIComponent(studyId)}` +
    `/series/${encodeURIComponent(seriesId)}/images/${position}`,
  dashboardOverview: "/dashboards/overview",
  patientDashboard: (patientId: string) => `/dashboards/patients/${encodeURIComponent(patientId)}`,
} as const;
