import type { Embedder } from "@health-mcp/rag";
import { syncPatientIndex } from "@health-mcp/rag";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

/** Injection token for the {@link Embedder}; `null` when indexing is off. */
export const EMBEDDER = Symbol("EMBEDDER");

/**
 * Keeps each patient's search index (RAG) in step with their records. Call
 * {@link syncPatient} after saving anything a patient's free text comes from;
 * only records whose text changed are embedded again.
 */
@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);
  /** The last sync of each patient, so syncs of one patient run one after another. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly database: DatabaseService,
    @Inject(EMBEDDER) private readonly embedder: Embedder | null,
  ) {}

  /**
   * Updates the patient's index. Never fails: the record is saved either way,
   * and a failed update is logged and repaired by the next sync or by
   * `yarn rag:reindex`.
   */
  syncPatient(patientId: string): Promise<void> {
    if (!this.embedder) return Promise.resolve();
    const embedder = this.embedder;
    const next = (this.running.get(patientId) ?? Promise.resolve()).then(() =>
      this.sync(patientId, embedder),
    );
    this.running.set(patientId, next);
    void next.then(() => {
      if (this.running.get(patientId) === next) this.running.delete(patientId);
    });
    return next;
  }

  private async sync(patientId: string, embedder: Embedder): Promise<void> {
    const started = performance.now();
    try {
      const { indexed, removed } = await syncPatientIndex(this.database.db, embedder, patientId);
      if (indexed > 0 || removed > 0)
        this.logger.log(
          `Search index for patient ${patientId}: ${indexed} records indexed, ${removed} removed ` +
            `in ${Math.round(performance.now() - started)} ms`,
        );
    } catch (error) {
      this.logger.warn(
        `Search index for patient ${patientId} not updated; it is repaired by the next ` +
          `change or by \`yarn rag:reindex\`. ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
