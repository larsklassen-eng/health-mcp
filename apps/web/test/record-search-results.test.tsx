import type { RecordPassage } from "@health-mcp/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChatToolCalls } from "@/app/patients/[id]/chat/chat-tool-calls";
import {
  matchLabel,
  RecordSearchResults,
  sourceHref,
} from "@/app/patients/[id]/chat/record-search-results";

const passage = (overrides: Partial<RecordPassage> = {}): RecordPassage => ({
  source: "imaging_report",
  sourceId: "s1",
  date: "2026-08-18",
  title: "Imaging report: MRI brain (2026-08-18)",
  text: "No residual enhancing tumor.",
  similarity: 0.82,
  matchedBy: ["vector", "keyword"],
  ...overrides,
});

describe("sourceHref", () => {
  it.each([
    ["imaging_report", "s1", "/patients/p1/imaging/s1"],
    ["patient_notes", "p1", "/patients/p1"],
    ["symptom", "y1", "/patients/p1/dashboard#symptom-y1"],
    ["chat_message", "m1", "#message-m1"],
  ] as const)("links a %s passage to its record", (source, sourceId, href) => {
    expect(sourceHref("p1", passage({ source, sourceId }))).toBe(href);
  });
});

describe("matchLabel", () => {
  it("shows the similarity and how the passage matched", () => {
    expect(matchLabel(passage())).toBe("similarity 0.82 · by meaning and keywords");
    expect(matchLabel(passage({ matchedBy: ["vector"], similarity: 0.6 }))).toBe(
      "similarity 0.60 · by meaning",
    );
  });

  it("leaves out the similarity of keyword-only matches", () => {
    const { similarity: _, ...keywordOnly } = passage({ matchedBy: ["keyword"] });
    expect(matchLabel(keywordOnly)).toBe("by keywords");
  });
});

describe("RecordSearchResults", () => {
  it("shows each passage under a link to its source, best first", () => {
    render(
      <RecordSearchResults
        patientId="p1"
        output={{
          passages: [
            passage(),
            passage({
              source: "symptom",
              sourceId: "y1",
              title: "Symptom (2026-09-02)",
              text: "Dizziness: when standing up.",
              matchedBy: ["vector"],
            }),
          ],
        }}
      />,
    );

    const [report, symptom] = within(
      screen.getByRole("list", { name: "Passages found" }),
    ).getAllByRole("listitem");
    expect(within(report!).getByRole("link")).toHaveAttribute("href", "/patients/p1/imaging/s1");
    expect(report).toHaveTextContent("Imaging report: MRI brain (2026-08-18)");
    expect(report).toHaveTextContent("similarity 0.82 · by meaning and keywords");
    expect(report!.querySelector("blockquote")).toHaveTextContent("No residual enhancing tumor.");
    expect(within(symptom!).getByRole("link", { name: "Symptom (2026-09-02)" })).toHaveAttribute(
      "href",
      "/patients/p1/dashboard#symptom-y1",
    );
  });

  it("shows the note when nothing relevant was found", () => {
    render(
      <RecordSearchResults
        patientId="p1"
        output={{
          passages: [],
          note: "No relevant passages were found in this patient's records.",
        }}
      />,
    );

    expect(screen.getByText(/No relevant passages were found/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("the chat's search card", () => {
  const searchCall = (output: unknown, isError = false) => ({
    id: "t1",
    name: "search_patient_records",
    input: { query: "dizziness" },
    output,
    isError,
  });

  it("shows the passages instead of the raw result", async () => {
    render(<ChatToolCalls patientId="p1" calls={[searchCall({ passages: [passage()] })]} />);

    const [card] = within(
      screen.getByRole("list", { name: "Data the assistant used" }),
    ).getAllByRole("listitem");
    expect(card).toHaveTextContent("Record search");
    expect(card).toHaveTextContent("query: dizziness");
    await userEvent.setup().click(within(card!).getByText("Record search"));
    expect(within(card!).getByRole("link")).toHaveAttribute("href", "/patients/p1/imaging/s1");
    expect(card!.querySelector("pre")).not.toBeInTheDocument();
  });

  it.each([
    ["an error", searchCall("Patient p9 not found.", true)],
    ["an unexpected result", searchCall({ results: [] })],
  ])("shows %s as text", (_, call) => {
    render(<ChatToolCalls patientId="p1" calls={[call]} />);

    expect(screen.getByRole("listitem").querySelector("pre")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
