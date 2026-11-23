import { medications, patients, symptoms } from "@health-mcp/db";
import type { RecordChangesOutput } from "@health-mcp/shared";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AddMedicationOutput } from "../src/tools/add-medication.js";
import { insertMedication, insertPatient, startTestServer, type TestServer } from "./helpers.js";

const NOW = new Date("2026-11-20T09:30:00.000Z");

let server: TestServer;
let client: Client;
let patientId: string;
beforeEach(async () => {
  server = await startTestServer({ now: () => NOW });
  client = await server.connect();
  patientId = insertPatient(server.db, {
    diagnosis: "Glioblastoma",
    surgeryDate: "2026-03-10",
    notes: "Resection 2026-03-10.",
  }).id;
});
afterEach(async () => {
  await server.close();
});

const call = async (name: string, args: Record<string, unknown>, forPatient = patientId) =>
  (await client.callTool({
    name,
    arguments: { patient_id: forPatient, ...args },
  })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content[0]?.type === "text" ? result.content[0].text : "";
const changes = async (name: string, args: Record<string, unknown>) => {
  const result = await call(name, args);
  expect(result.isError, text(result)).toBeFalsy();
  return (JSON.parse(text(result)) as RecordChangesOutput).changes;
};
const patient = () => server.db.select().from(patients).where(eq(patients.id, patientId)).get()!;
const medication = (id: string) =>
  server.db.select().from(medications).where(eq(medications.id, id)).get()!;

describe("update_patient_profile", () => {
  it("adds a dated line to the notes, keeping what is there", async () => {
    expect(
      await changes("update_patient_profile", { add_note: "Resection was gross total." }),
    ).toEqual([{ field: "notes (added)", after: "2026-11-20: Resection was gross total." }]);
    expect(patient().notes).toBe("Resection 2026-03-10.\n\n2026-11-20: Resection was gross total.");
  });

  it("starts empty notes with the line", async () => {
    server.db.update(patients).set({ notes: null }).where(eq(patients.id, patientId)).run();
    await changes("update_patient_profile", { add_note: "Seizure-free." });
    expect(patient().notes).toBe("2026-11-20: Seizure-free.");
  });

  it("changes the diagnosis, surgery date and status, with their old values", async () => {
    expect(
      await changes("update_patient_profile", {
        diagnosis: "Glioblastoma, IDH-wildtype",
        surgery_date: "2026-03-11",
        status: "inactive",
      }),
    ).toEqual([
      { field: "diagnosis", before: "Glioblastoma", after: "Glioblastoma, IDH-wildtype" },
      { field: "surgery date", before: "2026-03-10", after: "2026-03-11" },
      { field: "status", before: "active", after: "inactive" },
    ]);
    expect(patient()).toMatchObject({
      diagnosis: "Glioblastoma, IDH-wildtype",
      surgeryDate: "2026-03-11",
      status: "inactive",
    });
  });

  it("refuses a change that changes nothing, or notes that grow too long", async () => {
    const same = await call("update_patient_profile", { diagnosis: "Glioblastoma" });
    expect(same.isError).toBe(true);
    expect(text(same)).toMatch(/Nothing to change/);

    server.db
      .update(patients)
      .set({ notes: "x".repeat(4990) })
      .where(eq(patients.id, patientId))
      .run();
    const long = await call("update_patient_profile", { add_note: "Resection was gross total." });
    expect(long.isError).toBe(true);
    expect(patient().notes).toBe("x".repeat(4990));
  });

  it("rejects no changes at all, and an unknown patient", async () => {
    expect((await call("update_patient_profile", {})).isError).toBe(true);
    const unknown = await call("update_patient_profile", { status: "inactive" }, "nobody");
    expect(text(unknown)).toBe("Patient nobody not found.");
  });
});

describe("add_medication", () => {
  it("adds an active medication, started today unless given", async () => {
    const result = await call("add_medication", {
      name: "Levetiracetam",
      dosage: "500 mg",
      frequency: "twice daily",
      route: "oral",
    });
    const { medication: added } = JSON.parse(text(result)) as AddMedicationOutput;

    expect(added).toMatchObject({
      name: "Levetiracetam",
      dosage: "500 mg",
      status: "active",
      startDate: "2026-11-20",
    });
    expect(medication(added.id)).toMatchObject({ patientId, route: "oral" });
  });
});

describe("update_medication", () => {
  let dexamethasone: string;
  beforeEach(() => {
    dexamethasone = insertMedication(server.db, patientId, { name: "Dexamethasone" }).id;
  });

  it("changes the dosage and frequency, with their old values", async () => {
    expect(
      await changes("update_medication", {
        medication_id: dexamethasone,
        medication_name: "dexamethasone",
        dosage: "2 mg",
        frequency: "once daily",
      }),
    ).toEqual([
      { field: "medication", after: "Dexamethasone" },
      { field: "dosage", before: "4 mg", after: "2 mg" },
      { field: "frequency", before: "twice daily", after: "once daily" },
    ]);
    expect(medication(dexamethasone)).toMatchObject({ dosage: "2 mg", frequency: "once daily" });
  });

  it("stops it today, or on the date given, and not twice", async () => {
    await changes("update_medication", {
      medication_id: dexamethasone,
      medication_name: "Dexamethasone",
      stop: true,
    });
    expect(medication(dexamethasone)).toMatchObject({ status: "stopped", endDate: "2026-11-20" });

    const again = await call("update_medication", {
      medication_id: dexamethasone,
      medication_name: "Dexamethasone",
      stop: true,
    });
    expect(text(again)).toBe("Dexamethasone is already stopped. Nothing was saved.");

    const other = insertMedication(server.db, patientId, { name: "Ondansetron" }).id;
    await changes("update_medication", {
      medication_id: other,
      medication_name: "Ondansetron",
      stop: true,
      end_date: "2026-11-01",
    });
    expect(medication(other).endDate).toBe("2026-11-01");
  });

  it("refuses a name that is not the medication's, or another patient's medication", async () => {
    const wrongName = await call("update_medication", {
      medication_id: dexamethasone,
      medication_name: "Levetiracetam",
      dosage: "2 mg",
    });
    expect(text(wrongName)).toMatch(/is Dexamethasone, not Levetiracetam/);

    const other = insertPatient(server.db, { mrn: "FAKE-OTHER" }).id;
    const theirs = insertMedication(server.db, other, { name: "Dexamethasone" }).id;
    const result = await call("update_medication", {
      medication_id: theirs,
      medication_name: "Dexamethasone",
      dosage: "2 mg",
    });
    expect(text(result)).toMatch(/not found for this patient/);
    expect(medication(dexamethasone).dosage).toBe("4 mg");
    expect(medication(theirs).dosage).toBe("4 mg");
  });

  it("refuses an end date before the start", async () => {
    const result = await call("update_medication", {
      medication_id: dexamethasone,
      medication_name: "Dexamethasone",
      stop: true,
      end_date: "2026-01-01",
    });
    expect(result.isError).toBe(true);
    expect(medication(dexamethasone).status).toBe("active");
  });
});

describe("dry runs", () => {
  it("return the changes and save nothing, for every tool that changes data", async () => {
    const dex = insertMedication(server.db, patientId, { name: "Dexamethasone" }).id;
    const count = (table: typeof medications) => server.db.select().from(table).all().length;
    const before = { patient: patient(), medication: medication(dex), meds: count(medications) };

    expect(
      await changes("update_patient_profile", {
        dry_run: true,
        diagnosis: "Glioblastoma, IDH-wildtype",
        add_note: "Gross total.",
      }),
    ).toEqual([
      { field: "diagnosis", before: "Glioblastoma", after: "Glioblastoma, IDH-wildtype" },
      { field: "notes (added)", after: "2026-11-20: Gross total." },
    ]);
    expect(
      await changes("update_medication", {
        dry_run: true,
        medication_id: dex,
        medication_name: "Dexamethasone",
        stop: true,
      }),
    ).toEqual([
      { field: "medication", after: "Dexamethasone" },
      { field: "status", before: "active", after: "stopped" },
      { field: "end date", after: "2026-11-20" },
    ]);
    expect(
      await changes("add_medication", {
        dry_run: true,
        name: "Ondansetron",
        dosage: "8 mg",
        frequency: "as needed",
      }),
    ).toEqual([
      { field: "medication", after: "Ondansetron" },
      { field: "dosage", after: "8 mg" },
      { field: "frequency", after: "as needed" },
      { field: "start date", after: "2026-11-20" },
    ]);
    expect(
      await changes("log_symptom", { dry_run: true, name: " Headache ", severity: 4, notes: " " }),
    ).toEqual([
      { field: "symptom", after: "Headache" },
      { field: "severity", after: "4/10" },
    ]);

    expect(patient()).toEqual(before.patient);
    expect(medication(dex)).toEqual(before.medication);
    expect(count(medications)).toBe(before.meds);
    expect(server.db.select().from(symptoms).all()).toEqual([]);
  });

  it("refuse what the real call would refuse", async () => {
    const result = await call("update_patient_profile", {
      dry_run: true,
      diagnosis: "Glioblastoma",
    });
    expect(text(result)).toMatch(/Nothing to change/);
  });
});
