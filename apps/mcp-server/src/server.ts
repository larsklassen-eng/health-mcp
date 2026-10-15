import type { HealthDb } from "@health-mcp/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getPatientProfile } from "./tools/get-patient-profile.js";
import { registerTool } from "./tools/tool.js";

export const SERVER_INFO = { name: "health-mcp", version: "0.0.0" };

/** An MCP server with the patient-scoped health tools. Every tool requires `patient_id`. */
export function createMcpServer(db: HealthDb): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerTool(server, "get_patient_profile", getPatientProfile(db));
  return server;
}
