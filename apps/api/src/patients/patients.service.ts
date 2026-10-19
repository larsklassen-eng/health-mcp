import { imagingStudies, labResults, patients, toPatient, toPatientSummary } from "@health-mcp/db";
import type {
  CreatePatientInput,
  Patient,
  PatientSummary,
  UpdatePatientInput,
} from "@health-mcp/shared";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";

import { isUniqueViolation } from "../common/sqlite-errors.js";
import { DatabaseService } from "../database/database.service.js";
import { ImagingStorage } from "../imaging/imaging-storage.js";

@Injectable()
export class PatientsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ImagingStorage,
  ) {}

  list(): PatientSummary[] {
    return this.database.db
      .select()
      .from(patients)
      .orderBy(asc(patients.lastName), asc(patients.firstName))
      .all()
      .map(toPatientSummary);
  }

  get(id: string): Patient {
    const row = this.database.db.select().from(patients).where(eq(patients.id, id)).get();
    if (!row) throw new NotFoundException(`Patient ${id} not found`);
    return toPatient(row);
  }

  /** Names of the lab tests the patient has results for, alphabetically. */
  labTestNames(id: string): string[] {
    return this.database.db
      .selectDistinct({ testName: labResults.testName })
      .from(labResults)
      .where(eq(labResults.patientId, id))
      .orderBy(asc(labResults.testName))
      .all()
      .map((row) => row.testName);
  }

  create(input: CreatePatientInput): Patient {
    try {
      const [row] = this.database.db.insert(patients).values(input).returning().all();
      return toPatient(row!);
    } catch (error) {
      throw this.mapConflict(error, input.mrn);
    }
  }

  update(id: string, input: UpdatePatientInput): Patient {
    if (Object.keys(input).length === 0) return this.get(id);

    let row;
    try {
      [row] = this.database.db
        .update(patients)
        .set(input)
        .where(eq(patients.id, id))
        .returning()
        .all();
    } catch (error) {
      throw this.mapConflict(error, input.mrn);
    }
    if (!row) throw new NotFoundException(`Patient ${id} not found`);
    return toPatient(row);
  }

  /**
   * Deletes the patient and, through ON DELETE CASCADE, all of their records
   * and chat history; then the image files of their studies.
   */
  async remove(id: string): Promise<void> {
    const studies = this.database.db
      .select({ id: imagingStudies.id })
      .from(imagingStudies)
      .where(eq(imagingStudies.patientId, id))
      .all();
    const deleted = this.database.db
      .delete(patients)
      .where(eq(patients.id, id))
      .returning({ id: patients.id })
      .all();
    if (deleted.length === 0) throw new NotFoundException(`Patient ${id} not found`);
    await this.storage.removeStudies(studies.map((study) => study.id));
  }

  private mapConflict(error: unknown, mrn: string | undefined): unknown {
    return isUniqueViolation(error)
      ? new ConflictException(`A patient with MRN ${mrn} already exists`)
      : error;
  }
}
