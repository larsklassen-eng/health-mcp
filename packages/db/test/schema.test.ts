import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chatMessages,
  type DbConnection,
  labResults,
  medications,
  patients,
  recoveryMilestones,
  symptoms,
  vitalSigns,
} from "../src/index.js";
import { createTestDb, insertPatient, sqliteErrorCode } from "./helpers.js";

let connection: DbConnection;
beforeEach(() => {
  connection = createTestDb();
});
afterEach(() => {
  connection.close();
});

describe("patients", () => {
  it("generates a UUID and fills defaults", () => {
    const patient = insertPatient(connection);
    expect(patient.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(patient.status).toBe("active");
    expect(patient.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("refreshes updatedAt on update", async () => {
    const patient = insertPatient(connection);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [updated] = connection.db
      .update(patients)
      .set({ notes: "Walking unaided" })
      .where(eq(patients.id, patient.id))
      .returning()
      .all();

    expect(updated?.updatedAt).toBeDefined();
    expect(updated!.updatedAt > patient.updatedAt).toBe(true);
  });

  it("rejects a duplicate mrn", () => {
    insertPatient(connection);
    expect(sqliteErrorCode(() => insertPatient(connection))).toBe("SQLITE_CONSTRAINT_UNIQUE");
  });

  it.each([
    [
      "sex",
      "insert into patients (id, mrn, first_name, last_name, date_of_birth, sex, diagnosis) values ('x', 'M', 'a', 'b', '1990-01-01', 'robot', 'd')",
    ],
    [
      "status",
      "insert into patients (id, mrn, first_name, last_name, date_of_birth, sex, status, diagnosis) values ('x', 'M', 'a', 'b', '1990-01-01', 'male', 'archived', 'd')",
    ],
  ])("rejects an invalid %s even from raw SQL", (_column, statement) => {
    expect(sqliteErrorCode(() => connection.db.$client.prepare(statement).run())).toBe(
      "SQLITE_CONSTRAINT_CHECK",
    );
  });
});

describe("health records", () => {
  it("rejects records for a patient that does not exist", () => {
    const code = sqliteErrorCode(() =>
      connection.db
        .insert(vitalSigns)
        .values({
          patientId: "missing",
          type: "heart_rate",
          value: 70,
          unit: "bpm",
          recordedAt: "2026-09-10T13:00:00.000Z",
        })
        .run(),
    );
    expect(code).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
  });

  it.each([-1, 11])("rejects symptom severity %i", (severity) => {
    const patient = insertPatient(connection);
    const code = sqliteErrorCode(() =>
      connection.db
        .insert(symptoms)
        .values({
          patientId: patient.id,
          name: "headache",
          severity,
          recordedAt: "2026-09-10T13:00:00.000Z",
        })
        .run(),
    );
    expect(code).toBe("SQLITE_CONSTRAINT_CHECK");
  });

  it("allows a lab result without a flag", () => {
    const patient = insertPatient(connection);
    const insert = () =>
      connection.db
        .insert(labResults)
        .values({
          patientId: patient.id,
          testName: "Sodium",
          value: 140,
          unit: "mmol/L",
          collectedAt: "2026-09-10T13:00:00.000Z",
        })
        .run();
    expect(insert).not.toThrow();
  });

  it("deletes all of a patient's data with the patient", () => {
    const patient = insertPatient(connection);
    const other = insertPatient(connection, { mrn: "FAKE-002" });
    const at = "2026-09-10T13:00:00.000Z";
    for (const { id } of [patient, other]) {
      connection.db
        .insert(labResults)
        .values({ patientId: id, testName: "Hb", value: 12, unit: "g/dL", collectedAt: at })
        .run();
      connection.db
        .insert(vitalSigns)
        .values({ patientId: id, type: "pain_score", value: 3, unit: "", recordedAt: at })
        .run();
      connection.db
        .insert(medications)
        .values({
          patientId: id,
          name: "Dexamethasone",
          dosage: "4 mg",
          frequency: "daily",
          status: "active",
          startDate: "2026-09-01",
        })
        .run();
      connection.db
        .insert(symptoms)
        .values({ patientId: id, name: "headache", severity: 2, recordedAt: at })
        .run();
      connection.db.insert(recoveryMilestones).values({ patientId: id, title: "Walk 100 m" }).run();
      connection.db
        .insert(chatMessages)
        .values({ patientId: id, role: "user", content: "Hi" })
        .run();
    }

    connection.db.delete(patients).where(eq(patients.id, patient.id)).run();

    for (const table of [
      labResults,
      vitalSigns,
      medications,
      symptoms,
      recoveryMilestones,
      chatMessages,
    ]) {
      const rows = connection.db.select().from(table).all();
      expect(rows.map((row) => row.patientId)).toEqual([other.id]);
    }
  });
});

describe("chat_messages", () => {
  it("stores tool calls as JSON and defaults to an empty list", () => {
    const patient = insertPatient(connection);
    const toolCalls = [
      {
        id: "t1",
        name: "get_lab_results",
        input: { limit: 5 },
        output: [{ value: 1 }],
        isError: false,
      },
    ];
    connection.db
      .insert(chatMessages)
      .values({ patientId: patient.id, role: "assistant", content: "Done", toolCalls })
      .run();
    connection.db
      .insert(chatMessages)
      .values({ patientId: patient.id, role: "user", content: "Hi" })
      .run();

    const rows = connection.db.select().from(chatMessages).all();
    expect(rows.find((row) => row.role === "assistant")?.toolCalls).toEqual(toolCalls);
    expect(rows.find((row) => row.role === "user")?.toolCalls).toEqual([]);
  });

  it("rejects an unknown role", () => {
    const patient = insertPatient(connection);
    const code = sqliteErrorCode(() =>
      connection.db.$client
        .prepare(
          "insert into chat_messages (id, patient_id, role, content) values ('m1', ?, 'system', 'x')",
        )
        .run(patient.id),
    );
    expect(code).toBe("SQLITE_CONSTRAINT_CHECK");
  });
});
