import { symptoms } from "@health-mcp/db";
import { HashingEmbedder } from "@health-mcp/rag";
import { API_ROUTES, type Patient, PatientSchema } from "@health-mcp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/database/database.service.js";
import { LlmClient } from "../src/llm/llm-client.js";
import { McpClient } from "../src/mcp/mcp-client.js";
import { EMBEDDER } from "../src/rag/indexing.service.js";
import { FakeLlmClient } from "./fakes/fake-llm-client.js";
import { FakeMcpClient } from "./fakes/fake-mcp-client.js";
import { newPatient } from "./fixtures.js";
import { type ProviderOverride, startTestApp, type TestApp } from "./helpers.js";

let testApp: TestApp;
let llm: FakeLlmClient;
let mcp: FakeMcpClient;

async function start(overrides: ProviderOverride[] = []) {
  llm = new FakeLlmClient();
  mcp = new FakeMcpClient();
  testApp = await startTestApp(AppModule, [
    { provide: LlmClient, useValue: llm },
    { provide: McpClient, useValue: mcp },
    ...overrides,
  ]);
}
afterEach(async () => {
  await testApp.close();
  vi.restoreAllMocks();
});

const db = () => testApp.app.get(DatabaseService).db;

/** The patient's chunks as `source_type: text`, in a stable order. */
const chunks = (patientId: string) =>
  (
    db()
      .$client.prepare(
        "select source_type, text from record_chunks where patient_id = ? " +
          "order by source_type, source_id, chunk_index",
      )
      .all(patientId) as { source_type: string; text: string }[]
  ).map((row) => `${row.source_type}: ${row.text.split("\n").slice(1).join(" ")}`);

async function createPatient(overrides = {}): Promise<Patient> {
  const { status, body } = await testApp.request(
    "POST",
    API_ROUTES.patients,
    newPatient(overrides),
  );
  expect(status).toBe(201);
  return PatientSchema.parse(body);
}

describe("search index updates", () => {
  it("indexes a patient's notes when they are created, edited and cleared", async () => {
    await start();
    const patient = await createPatient({ notes: "Synthetic: walking unaided." });
    expect(chunks(patient.id)).toEqual(["patient_notes: Synthetic: walking unaided."]);

    await testApp.request("PATCH", API_ROUTES.patient(patient.id), {
      notes: "Synthetic: driving again.",
    });
    expect(chunks(patient.id)).toEqual(["patient_notes: Synthetic: driving again."]);

    await testApp.request("PATCH", API_ROUTES.patient(patient.id), { notes: null });
    expect(chunks(patient.id)).toEqual([]);
  });

  it("indexes imported notes, imaging reports and symptoms", async () => {
    await start();
    const { body } = await testApp.request("POST", API_ROUTES.patientsImport, {
      version: 1,
      patients: [
        {
          patient: newPatient({ notes: "Synthetic notes." }),
          symptoms: [{ name: "Dizziness", severity: 2, recordedAt: "2026-10-01T08:00:00Z" }],
          imagingStudies: [
            { modality: "MR", studyDate: "2026-08-18", report: "Synthetic report: stable." },
          ],
        },
      ],
    });
    const patientId = (body as { imported: { patientId: string }[] }).imported[0]!.patientId;

    expect(chunks(patientId)).toEqual([
      "imaging_report: Synthetic report: stable.",
      "patient_notes: Synthetic notes.",
      "symptom: Dizziness, severity 2/10.",
    ]);
  });

  it("follows report edits and removes a deleted study's chunks", async () => {
    await start();
    const { body } = await testApp.request("POST", API_ROUTES.patientsImport, {
      version: 1,
      patients: [
        {
          patient: newPatient(),
          imagingStudies: [
            { modality: "CT", studyDate: "2026-08-06", report: "Synthetic: no bleed." },
          ],
        },
      ],
    });
    const patientId = (body as { imported: { patientId: string }[] }).imported[0]!.patientId;
    const studies = await testApp.request("GET", API_ROUTES.patientImaging(patientId));
    const studyId = (studies.body as { studies: { id: string }[] }).studies[0]!.id;

    await testApp.request("PATCH", API_ROUTES.imagingStudy(patientId, studyId), {
      impression: "Synthetic: stable.",
    });
    expect(chunks(patientId)).toEqual([
      "imaging_report: Impression: Synthetic: stable.  Synthetic: no bleed.",
    ]);

    await testApp.request("DELETE", API_ROUTES.imagingStudy(patientId, studyId));
    expect(chunks(patientId)).toEqual([]);
  });

  it("indexes the clinician's chat messages, not the assistant's answers", async () => {
    await start();
    const patient = await createPatient();
    llm.replyWithText("Synthetic answer.");

    await fetch(`${testApp.url}${API_ROUTES.patientChat(patient.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "She felt dizzy on Monday." }),
    }).then((response) => response.text());

    expect(chunks(patient.id)).toEqual(["chat_message: She felt dizzy on Monday."]);
  });

  it("indexes a symptom once the clinician confirms it", async () => {
    await start();
    const patient = await createPatient();
    // The fake MCP server saves the symptom like the real one does.
    mcp.offer("log_symptom", (args) => {
      db()
        .insert(symptoms)
        .values({
          patientId: patient.id,
          name: String(args.name),
          severity: Number(args.severity),
          recordedAt: "2026-10-27T09:00:00.000Z",
        })
        .run();
      return { output: { symptom: args }, isError: false };
    });
    llm
      .replyWithToolCalls({
        id: "t1",
        name: "log_symptom",
        arguments: { name: "Nausea", severity: 3 },
      })
      .replyWithText("Please confirm.");
    await fetch(`${testApp.url}${API_ROUTES.patientChat(patient.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Log nausea, severity 3." }),
    }).then((response) => response.text());

    await testApp.request("POST", API_ROUTES.toolCallDecision(patient.id, "t1"), {
      decision: "confirm",
    });

    expect(chunks(patient.id)).toContain("symptom: Nausea, severity 3/10.");
  });

  it("still saves the record when indexing fails", async () => {
    const failing = new HashingEmbedder();
    vi.spyOn(failing, "embedDocuments").mockRejectedValue(new Error("model unavailable"));
    await start([{ provide: EMBEDDER, useValue: failing }]);

    const patient = await createPatient({ notes: "Synthetic notes." });

    expect(chunks(patient.id)).toEqual([]);
    expect((await testApp.request("GET", API_ROUTES.patient(patient.id))).status).toBe(200);
  });

  it("does not index when RAG_EMBEDDER is off", async () => {
    await start([{ provide: ENV, useValue: { ...loadEnv(), RAG_EMBEDDER: "off" } }]);

    const patient = await createPatient({ notes: "Synthetic notes." });

    expect(chunks(patient.id)).toEqual([]);
  });
});
