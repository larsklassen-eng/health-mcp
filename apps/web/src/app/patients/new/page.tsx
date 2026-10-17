import { createPatientAction } from "../actions";
import { PatientForm } from "../patient-form";

export default function NewPatientPage() {
  return (
    <>
      <div className="page-header">
        <h1>New patient</h1>
      </div>
      <PatientForm action={createPatientAction} />
    </>
  );
}
