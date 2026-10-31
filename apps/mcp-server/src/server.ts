import type { HealthDb } from "@health-mcp/db";
import type { Embedder, Reranker } from "@health-mcp/rag";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getImagingStudies } from "./tools/get-imaging-studies.js";
import { getLabResults } from "./tools/get-lab-results.js";
import { getMedications } from "./tools/get-medications.js";
import { getPatientProfile } from "./tools/get-patient-profile.js";
import { getRecoveryMilestones } from "./tools/get-recovery-milestones.js";
import { getVitalsTrend } from "./tools/get-vitals-trend.js";
import { logSymptom } from "./tools/log-symptom.js";
import { searchPatientRecords } from "./tools/search-patient-records.js";
import { registerTool } from "./tools/tool.js";

export const SERVER_INFO = { name: "health-mcp", version: "0.0.0" };

export interface McpServerOptions {
  /** Clock for "recent" windows and new records; tests pass a fixed time. */
  now?: () => Date;
  /** Embeds search queries; without it, `search_patient_records` is not offered. */
  embedder?: Embedder | null;
  /** Re-orders search results; optional. */
  reranker?: Reranker | null;
}

/** An MCP server with the patient-scoped health tools. Every tool requires `patient_id`. */
export function createMcpServer(
  db: HealthDb,
  { now, embedder, reranker }: McpServerOptions = {},
): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerTool(server, "get_patient_profile", getPatientProfile(db));
  registerTool(server, "get_lab_results", getLabResults(db));
  registerTool(server, "get_vitals_trend", getVitalsTrend(db, now));
  registerTool(server, "get_medications", getMedications(db));
  registerTool(server, "get_recovery_milestones", getRecoveryMilestones(db));
  registerTool(server, "log_symptom", logSymptom(db, now));
  registerTool(server, "get_imaging_studies", getImagingStudies(db));
  if (embedder)
    registerTool(server, "search_patient_records", searchPatientRecords(db, embedder, reranker));
  return server;
}
