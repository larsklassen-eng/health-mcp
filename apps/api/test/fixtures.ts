import type { CreatePatientInput } from "@health-mcp/shared";

/** A minimal valid synthetic patient; pass overrides for variants. */
export const newPatient = (overrides: Partial<CreatePatientInput> = {}): CreatePatientInput => ({
  mrn: "FAKE-001",
  firstName: "Ana",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  sex: "female",
  diagnosis: "Synthetic meningioma",
  ...overrides,
});
