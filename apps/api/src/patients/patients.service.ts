import { patients } from "@health-mcp/db";
import type { CreatePatientInput, Patient, PatientSummary, UpdatePatientInput } from "@health-mcp/shared";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";

import { isUniqueViolation } from "../common/sqlite-errors.js";
import { DatabaseService } from "../database/database.service.js";
import { toPatient, toPatientSummary } from "./patient.mapper.js";

@Injectable()
export class PatientsService {
  constructor(private readonly database: DatabaseService) {}

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
      [row] = this.database.db.update(patients).set(input).where(eq(patients.id, id)).returning().all();
    } catch (error) {
      throw this.mapConflict(error, input.mrn);
    }
    if (!row) throw new NotFoundException(`Patient ${id} not found`);
    return toPatient(row);
  }

  /** Deletes the patient and, through ON DELETE CASCADE, all of their records and chat history. */
  remove(id: string): void {
    const deleted = this.database.db.delete(patients).where(eq(patients.id, id)).returning({ id: patients.id }).all();
    if (deleted.length === 0) throw new NotFoundException(`Patient ${id} not found`);
  }

  private mapConflict(error: unknown, mrn: string | undefined): unknown {
    return isUniqueViolation(error) ? new ConflictException(`A patient with MRN ${mrn} already exists`) : error;
  }
}
