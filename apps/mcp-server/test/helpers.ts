import type { AddressInfo } from "node:net";

import { createDb, type HealthDb, labResults, migrateDb, patients, vitalSigns } from "@health-mcp/db";
import type { CreatePatientInput, LabResultInput, VitalSignInput } from "@health-mcp/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createApp, MCP_PATH } from "../src/app.js";
import type { McpServerOptions } from "../src/server.js";

export const TEST_TOKEN = "test-token-0123456789abcdef0123456789abcdef";

export interface TestServer {
  db: HealthDb;
  /** Base URL, e.g. `http://127.0.0.1:54321`. */
  url: string;
  /** An MCP client connected with `token` (the right one by default). */
  connect: (token?: string) => Promise<Client>;
  close: () => Promise<void>;
}

/** Runs the app on a random loopback port with a fresh, migrated in-memory database. */
export async function startTestServer(options: McpServerOptions = {}): Promise<TestServer> {
  const connection = createDb({ path: ":memory:" });
  migrateDb(connection.db);
  const server = createApp({ db: connection.db, authToken: TEST_TOKEN, ...options }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const clients: Client[] = [];

  return {
    db: connection.db,
    url,
    async connect(token = TEST_TOKEN) {
      const client = new Client({ name: "test", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(MCP_PATH, url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      clients.push(client);
      await client.connect(transport as Transport);
      return client;
    },
    async close() {
      await Promise.all(clients.map((client) => client.close()));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      connection.close();
    },
  };
}

export function insertPatient(db: HealthDb, overrides: Partial<CreatePatientInput> = {}) {
  return db
    .insert(patients)
    .values({
      mrn: "FAKE-001",
      firstName: "Ana",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      sex: "female",
      diagnosis: "Synthetic meningioma",
      ...overrides,
    })
    .returning()
    .get();
}

export function insertLab(db: HealthDb, patientId: string, lab: Partial<LabResultInput> & Pick<LabResultInput, "collectedAt">) {
  return db
    .insert(labResults)
    .values({ testName: "Hemoglobin", value: 13.5, unit: "g/dL", ...lab, patientId })
    .returning()
    .get();
}

export function insertVital(db: HealthDb, patientId: string, vital: Partial<VitalSignInput> & Pick<VitalSignInput, "recordedAt" | "value">) {
  return db
    .insert(vitalSigns)
    .values({ type: "heart_rate", unit: "bpm", ...vital, patientId })
    .returning()
    .get();
}
