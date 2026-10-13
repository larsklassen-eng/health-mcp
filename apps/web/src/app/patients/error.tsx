"use client";

export default function PatientsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="alert error" role="alert">
      <p>
        <strong>Something went wrong while loading this page.</strong> Check the web and api logs for details.
      </p>
      <button type="button" className="button secondary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
