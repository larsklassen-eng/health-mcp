import type { ImagingSeries } from "@health-mcp/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ImageViewer } from "@/app/patients/[id]/imaging/[studyId]/image-viewer";

const series = (id: string, imageCount: number, description?: string): ImagingSeries => ({
  id,
  studyId: "s1",
  modality: "MR",
  imageCount,
  ...(description && { description }),
});

const imageSrc = () => screen.getByRole("img").getAttribute("src");
const setup = (list: ImagingSeries[]) => {
  render(<ImageViewer patientId="p1" studyId="s1" series={list} />);
  return userEvent.setup();
};

describe("ImageViewer", () => {
  it("starts at the middle slice of the first series with images", () => {
    setup([series("empty", 0, "Compressed"), series("t1", 5, "Ax T1")]);

    expect(imageSrc()).toBe("/patients/p1/imaging/s1/series/t1/images/2");
    expect(screen.getByRole("img")).toHaveAccessibleName("Ax T1, slice 3 of 5");
    expect(screen.getByText("Slice 3 of 5")).toBeInTheDocument();
    // A single viewable series needs no series buttons.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("moves with the buttons, the slider and the keyboard, within bounds", async () => {
    const user = setup([series("t1", 3)]);

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(imageSrc()).toMatch(/images\/2$/);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.change(screen.getByRole("slider", { name: "Slice" }), { target: { value: "1" } });
    expect(imageSrc()).toMatch(/images\/0$/);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    const frame = screen.getByLabelText(/Image viewer/);
    fireEvent.keyDown(frame, { key: "ArrowDown" });
    expect(imageSrc()).toMatch(/images\/1$/);
    fireEvent.keyDown(frame, { key: "End" });
    expect(imageSrc()).toMatch(/images\/2$/);
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(imageSrc()).toMatch(/images\/2$/);
  });

  it("moves with the mouse wheel", () => {
    setup([series("t1", 4)]);

    fireEvent.wheel(screen.getByLabelText(/Image viewer/), { deltaY: 100 });

    expect(imageSrc()).toMatch(/images\/3$/);
  });

  it("switches series and starts at its middle slice", async () => {
    const user = setup([series("t1", 3, "Ax T1"), series("t2", 9, "Ax T2")]);

    await user.click(screen.getByRole("tab", { name: "Ax T2 (9)" }));

    expect(screen.getByRole("tab", { name: "Ax T2 (9)" })).toHaveAttribute("aria-selected", "true");
    expect(imageSrc()).toBe("/patients/p1/imaging/s1/series/t2/images/4");
  });

  it("explains when no series has images it can show", () => {
    setup([series("jpeg", 0)]);

    expect(screen.getByText("This study has no images that can be shown.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
