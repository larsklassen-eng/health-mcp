"use client";

import { API_ROUTES, type DicomImportResult, DicomImportResultSchema } from "@health-mcp/shared";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { formatDate, modalityLabel } from "@/lib/format";

type Status =
  | { state: "idle" }
  | { state: "uploading"; percent: number }
  | { state: "processing" }
  | { state: "done"; result: DicomImportResult }
  | { state: "error"; message: string };

const ERRORS: Record<number, string> = {
  400: "The file is not a valid zip of DICOM files.",
  404: "This patient no longer exists.",
  413: "The file is larger than 2 GB.",
  415: "Choose a .zip file.",
  503: "The api is not reachable. Is it running?",
};

/** Uploads a zip with upload progress (which `fetch` cannot report). */
function upload(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", "application/zip");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = undefined;
      }
      resolve({ status: request.status, body });
    };
    request.onerror = () => reject(new Error("network error"));
    request.send(file);
  });
}

export function DicomUploadForm({ patientId }: { patientId: string }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const busy = status.state === "uploading" || status.state === "processing";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || file.size === 0) {
      setStatus({ state: "error", message: "Choose a zip file with the DICOM images." });
      return;
    }
    setStatus({ state: "uploading", percent: 0 });
    try {
      const { status: code, body } = await upload(
        API_ROUTES.dicomUpload(patientId),
        file,
        (percent) =>
          setStatus(percent < 100 ? { state: "uploading", percent } : { state: "processing" }),
      );
      const result = DicomImportResultSchema.safeParse(body);
      if (code === 201 && result.success) setStatus({ state: "done", result: result.data });
      else
        setStatus({
          state: "error",
          message: ERRORS[code] ?? "The upload failed. Nothing was saved. Please try again.",
        });
    } catch {
      setStatus({
        state: "error",
        message: "The upload failed. Check your connection and try again.",
      });
    }
  }

  return (
    <form className="form card" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="file">Zip file with DICOM images</label>
        <input id="file" name="file" type="file" accept=".zip,application/zip" disabled={busy} />
        <span className="muted small">
          Zip the whole CD or DVD folder; files that are not images (such as the viewer program) are
          skipped. Up to 2 GB.
        </span>
      </div>

      {status.state === "uploading" && (
        <div role="status">
          <progress value={status.percent} max={100} aria-label="Upload progress" />{" "}
          {`Uploading… ${status.percent}%`}
        </div>
      )}
      {status.state === "processing" && (
        <p role="status">Reading the images… this can take a minute for a large study.</p>
      )}
      {status.state === "error" && (
        <div className="alert error" role="alert">
          {status.message}
        </div>
      )}
      {status.state === "done" && <UploadResult patientId={patientId} result={status.result} />}

      <div>
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}

function UploadResult({ patientId, result }: { patientId: string; result: DicomImportResult }) {
  if (result.studies.length === 0)
    return (
      <div className="alert error" role="alert">
        No DICOM images were found in the zip.
      </div>
    );
  return (
    <div className="alert success" role="status">
      <strong>
        {result.studies.length} {result.studies.length === 1 ? "study" : "studies"} uploaded.
      </strong>
      <ul>
        {result.studies.map((study) => (
          <li key={study.studyId}>
            <Link href={`/patients/${encodeURIComponent(patientId)}/imaging/${study.studyId}`}>
              {modalityLabel(study.modality)}, {formatDate(study.studyDate)}
              {study.description && ` (${study.description})`}
            </Link>
            : {study.series} series, {study.images} images
            {study.alreadyImported && " (already uploaded before; nothing new saved)"}
          </li>
        ))}
      </ul>
      {(result.skippedFiles > 0 || result.unsupportedImages > 0) && (
        <p className="muted small">
          {result.skippedFiles > 0 && `${result.skippedFiles} other files skipped. `}
          {result.unsupportedImages > 0 &&
            `${result.unsupportedImages} images are in a compressed format the viewer cannot show.`}
        </p>
      )}
    </div>
  );
}
