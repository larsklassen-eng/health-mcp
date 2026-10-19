import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DicomUploadForm } from "@/app/patients/[id]/imaging/upload/dicom-upload-form";

/** Stands in for XMLHttpRequest: reports progress, then answers with `status` and `body`. */
function fakeXhr(status: number, body: unknown) {
  const sent: { url?: string; type?: string; file?: unknown } = {};
  class FakeXhr {
    status = 0;
    responseText = "";
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open(_method: string, url: string) {
      sent.url = url;
    }
    setRequestHeader(name: string, value: string) {
      if (name === "Content-Type") sent.type = value;
    }
    send(file: unknown) {
      sent.file = file;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
      this.status = status;
      this.responseText = JSON.stringify(body);
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return sent;
}
afterEach(() => vi.unstubAllGlobals());

const zip = new File(["PK"], "cd.zip", { type: "application/zip" });

async function submit(file: File | null = zip) {
  const user = userEvent.setup();
  render(<DicomUploadForm patientId="p1" />);
  if (file) await user.upload(screen.getByLabelText("Zip file with DICOM images"), file);
  await user.click(screen.getByRole("button", { name: "Upload" }));
}

describe("DicomUploadForm", () => {
  it("uploads the zip and lists the studies with links", async () => {
    const sent = fakeXhr(201, {
      studies: [
        {
          studyId: "s1",
          modality: "MR",
          description: "MRI brain",
          studyDate: "2026-08-13",
          series: 4,
          images: 300,
          alreadyImported: false,
        },
        {
          studyId: "s2",
          modality: "CR",
          studyDate: "2026-08-17",
          series: 1,
          images: 2,
          alreadyImported: true,
        },
      ],
      skippedFiles: 3699,
      unsupportedImages: 2,
    });

    await submit();

    const result = await screen.findByText("2 studies uploaded.");
    expect(sent).toEqual({ url: "/patients/p1/imaging/dicom", type: "application/zip", file: zip });
    expect(screen.getByRole("link", { name: "MRI, Aug 13, 2026 (MRI brain)" })).toHaveAttribute(
      "href",
      "/patients/p1/imaging/s1",
    );
    const box = result.closest("div")!;
    expect(box).toHaveTextContent("4 series, 300 images");
    expect(box).toHaveTextContent("already uploaded before; nothing new saved");
    expect(box).toHaveTextContent("3699 other files skipped.");
    expect(box).toHaveTextContent("2 images are in a compressed format");
  });

  it.each([
    [400, "not a valid zip of DICOM files"],
    [413, "larger than 2 GB"],
    [503, "api is not reachable"],
    [500, "The upload failed. Nothing was saved."],
  ])("explains a %i", async (status, message) => {
    fakeXhr(status, { statusCode: status, error: "x", message: "x" });

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("says when the zip had no DICOM images", async () => {
    fakeXhr(201, { studies: [], skippedFiles: 5, unsupportedImages: 0 });

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("No DICOM images were found");
  });

  it("asks for a file before uploading", async () => {
    const sent = fakeXhr(201, {});

    await submit(null);

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a zip file");
    expect(sent.url).toBeUndefined();
  });
});
