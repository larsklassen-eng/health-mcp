import {
  chatMessages,
  type HealthDb,
  imagingStudies,
  omitNulls,
  patients,
  symptoms,
  toPatient,
} from "@health-mcp/db";
import type { ChunkSourceType } from "@health-mcp/shared";
import { asc, eq } from "drizzle-orm";

import type { ChunkOptions } from "./chunker.js";
import type { Embedder } from "./embedder.js";
import {
  chatMessageSource,
  chunkSource,
  imagingStudySource,
  patientNotesSource,
  symptomSource,
  type TextSource,
} from "./sources.js";
import { indexSource } from "./store.js";

/*
 * Keeps a patient's search index in step with their records by comparing
 * content: every searchable text is chunked again (cheap, no model) and only
 * records whose chunks differ from the stored ones are embedded. One call
 * after any write is enough, whatever was added, edited or deleted.
 */

export interface SyncResult {
  /** Records whose chunks were (re)embedded. */
  indexed: number;
  /** Records whose chunks were removed (record deleted or text emptied). */
  removed: number;
  /** Records already up to date. */
  unchanged: number;
}

const key = (sourceType: ChunkSourceType, sourceId: string) => `${sourceType}:${sourceId}`;

/** Every searchable text the patient has now. Empty if the patient does not exist. */
export function patientSources(db: HealthDb, patientId: string): TextSource[] {
  const row = db.select().from(patients).where(eq(patients.id, patientId)).get();
  if (!row) return [];

  const studies = db
    .select()
    .from(imagingStudies)
    .where(eq(imagingStudies.patientId, patientId))
    .all()
    .map((study) => imagingStudySource(omitNulls(study)));
  const reported = db
    .select()
    .from(symptoms)
    .where(eq(symptoms.patientId, patientId))
    .all()
    .map((symptom) => symptomSource(omitNulls(symptom)));
  const messages = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.patientId, patientId))
    .orderBy(asc(chatMessages.createdAt))
    .all()
    .map(chatMessageSource);

  return [patientNotesSource(toPatient(row)), ...studies, ...reported, ...messages].filter(
    (source) => source !== undefined,
  );
}

/** Brings one patient's index up to date. */
export async function syncPatientIndex(
  db: HealthDb,
  embedder: Embedder,
  patientId: string,
  options?: ChunkOptions,
): Promise<SyncResult> {
  const current = new Map(
    patientSources(db, patientId).map((source) => [
      key(source.sourceType, source.sourceId),
      source,
    ]),
  );

  // What is stored: each record's chunk texts and date, in chunk order.
  const stored = new Map<
    string,
    { sourceType: ChunkSourceType; sourceId: string; texts: string[]; date: string }
  >();
  const rows = db.$client
    .prepare(
      "select source_type, source_id, source_date, text from record_chunks " +
        "where patient_id = ? order by source_type, source_id, chunk_index",
    )
    .all(patientId) as {
    source_type: ChunkSourceType;
    source_id: string;
    source_date: string;
    text: string;
  }[];
  for (const row of rows) {
    const entry = stored.get(key(row.source_type, row.source_id)) ?? {
      sourceType: row.source_type,
      sourceId: row.source_id,
      texts: [],
      date: row.source_date,
    };
    entry.texts.push(row.text);
    stored.set(key(row.source_type, row.source_id), entry);
  }

  const result: SyncResult = { indexed: 0, removed: 0, unchanged: 0 };
  for (const [sourceKey, source] of current) {
    const chunks = chunkSource(source, options);
    const before = stored.get(sourceKey);
    const same =
      before?.date === source.sourceDate &&
      before.texts.length === chunks.length &&
      before.texts.every((text, i) => text === chunks[i]!.text);
    if (same) {
      result.unchanged++;
      continue;
    }
    const ref = { patientId, sourceType: source.sourceType, sourceId: source.sourceId };
    await indexSource(db, embedder, ref, source, options);
    result.indexed++;
  }
  for (const [sourceKey, { sourceType, sourceId }] of stored) {
    if (current.has(sourceKey)) continue;
    await indexSource(db, embedder, { patientId, sourceType, sourceId }, undefined);
    result.removed++;
  }
  return result;
}

/**
 * Syncs every patient. With `full`, all chunks are deleted first and
 * everything is embedded again (after changing the model or chunk size).
 */
export async function syncAllPatients(
  db: HealthDb,
  embedder: Embedder,
  { full = false, ...options }: ChunkOptions & { full?: boolean } = {},
): Promise<SyncResult & { patients: number }> {
  if (full) db.$client.prepare("delete from record_chunks").run();
  const totals = { patients: 0, indexed: 0, removed: 0, unchanged: 0 };
  for (const { id } of db.select({ id: patients.id }).from(patients).all()) {
    const result = await syncPatientIndex(db, embedder, id, options);
    totals.patients++;
    totals.indexed += result.indexed;
    totals.removed += result.removed;
    totals.unchanged += result.unchanged;
  }
  return totals;
}
