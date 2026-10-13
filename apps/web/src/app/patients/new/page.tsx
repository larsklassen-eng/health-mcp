import { createPatientAction } from "../actions";
import { CreatePatientForm } from "../create-patient-form";

export default function NewPatientPage() {
  return (
    <>
      <div className="page-header">
        <h1>New patient</h1>
      </div>
      <CreatePatientForm action={createPatientAction} />
    </>
  );
}
