import {
  imagingStudies,
  labResults,
  medications,
  patients,
  recoveryMilestones,
  symptoms,
  vitalSigns,
} from "@health-mcp/db";
import type { ParsedPatientImportFile, PatientImportResult } from "@health-mcp/shared";
import { ConflictException, Injectable } from "@nestjs/common";

import { isUniqueViolation } from "../common/sqlite-errors.js";
import { DatabaseService } from "../database/database.service.js";

/**
 * Stored timestamps must be UTC (`...Z`) so text order matches time order;
 * imports may carry offsets.
 */
const toUtc = (timestamp: string): string => new Date(timestamp).toISOString();
const toUtcOptional = (timestamp: string | undefined): string | undefined =>
  timestamp === undefined ? undefined : toUtc(timestamp);

@Injectable()
export class PatientImportService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Imports every patient in the file with all of their records, in one
   * transaction: if anything fails (e.g. a duplicate MRN), nothing is saved.
   */
  import(file: ParsedPatientImportFile): PatientImportResult {
    const duplicate = findDuplicateMrn(file);
    if (duplicate)
      throw new ConflictException(`MRN ${duplicate} appears more than once in the import file`);

    let currentMrn = "";
    try {
      return this.database.db.transaction((tx) => {
        const imported: PatientImportResult["imported"] = [];

        for (const bundle of file.patients) {
          currentMrn = bundle.patient.mrn;
          const [patient] = tx
            .insert(patients)
            .values(bundle.patient)
            .returning({ id: patients.id })
            .all();
          const patientId = patient!.id;

          const labs = bundle.labResults.map((lab) => ({
            ...lab,
            patientId,
            collectedAt: toUtc(lab.collectedAt),
          }));
          const vitals = bundle.vitals.map((vital) => ({
            ...vital,
            patientId,
            recordedAt: toUtc(vital.recordedAt),
          }));
          const meds = bundle.medications.map((medication) => ({ ...medication, patientId }));
          const reported = bundle.symptoms.map((symptom) => ({
            ...symptom,
            patientId,
            recordedAt: toUtc(symptom.recordedAt),
          }));
          const milestones = bundle.milestones.map((milestone) => ({
            ...milestone,
            patientId,
            achievedAt: toUtcOptional(milestone.achievedAt),
          }));

          if (labs.length > 0) tx.insert(labResults).values(labs).run();
          if (vitals.length > 0) tx.insert(vitalSigns).values(vitals).run();
          if (meds.length > 0) tx.insert(medications).values(meds).run();
          if (reported.length > 0) tx.insert(symptoms).values(reported).run();
          if (milestones.length > 0) tx.insert(recoveryMilestones).values(milestones).run();
          // Imported studies have a report but no images.
          const studies = bundle.imagingStudies.map((study) => ({
            ...study,
            patientId,
            source: "import" as const,
          }));
          if (studies.length > 0) tx.insert(imagingStudies).values(studies).run();

          imported.push({
            patientId,
            mrn: bundle.patient.mrn,
            records:
              labs.length +
              vitals.length +
              meds.length +
              reported.length +
              milestones.length +
              studies.length,
          });
        }

        return { imported };
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(`A patient with MRN ${currentMrn} already exists`);
      throw error;
    }
  }
}

function findDuplicateMrn(file: ParsedPatientImportFile): string | undefined {
  const seen = new Set<string>();
  for (const { patient } of file.patients) {
    if (seen.has(patient.mrn)) return patient.mrn;
    seen.add(patient.mrn);
  }
  return undefined;
}
