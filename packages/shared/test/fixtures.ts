import type { CreatePatientInput } from "../src/index.js";

/** A minimal valid synthetic patient. */
export const validPatient: CreatePatientInput = {
  mrn: "FAKE-001",
  firstName: "Ana",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  sex: "female",
  diagnosis: "Synthetic meningioma",
};
