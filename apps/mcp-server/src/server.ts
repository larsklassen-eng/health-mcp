import type { HealthDb } from "@health-mcp/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getLabResults } from "./tools/get-lab-results.js";
import { getPatientProfile } from "./tools/get-patient-profile.js";
import { getVitalsTrend } from "./tools/get-vitals-trend.js";
import { registerTool } from "./tools/tool.js";

export const SERVER_INFO = { name: "health-mcp", version: "0.0.0" };

export interface McpServerOptions {
  /** Clock for "recent" windows; tests pass a fixed time. */
  now?: () => Date;
}

/** An MCP server with the patient-scoped health tools. Every tool requires `patient_id`. */
export function createMcpServer(db: HealthDb, { now }: McpServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerTool(server, "get_patient_profile", getPatientProfile(db));
  registerTool(server, "get_lab_results", getLabResults(db));
  registerTool(server, "get_vitals_trend", getVitalsTrend(db, now));
  return server;
}
