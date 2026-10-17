import type { ToolCall } from "@health-mcp/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChatToolCalls, formatToolInput, MAX_OUTPUT_CHARS } from "@/app/patients/[id]/chat/chat-tool-calls";

const labCall: ToolCall = {
  id: "t1",
  name: "get_lab_results",
  input: { test_name: "Hemoglobin", since: "2026-09-01T00:00:00.000Z", limit: 20 },
  output: { results: [{ testName: "Hemoglobin", value: 11.2 }], hasMore: false },
  isError: false,
};

describe("formatToolInput", () => {
  it("lists the arguments in plain words, with dates in UTC", () => {
    expect(formatToolInput(labCall.input)).toBe("test name: Hemoglobin · since: Sep 1, 2026 · limit: 20");
  });

  it("is empty for a tool without arguments", () => {
    expect(formatToolInput({})).toBe("");
  });
});

describe("ChatToolCalls", () => {
  it("renders nothing without tool calls", () => {
    const { container } = render(<ChatToolCalls calls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each call collapsed, with its label, arguments and status", async () => {
    render(<ChatToolCalls calls={[labCall, { id: "t2", name: "get_patient_profile", input: {}, output: { id: "p1" }, isError: false }]} />);

    const [lab, profile] = within(screen.getByRole("list", { name: "Data the assistant used" })).getAllByRole("listitem");
    expect(lab).toHaveTextContent("Lab results");
    expect(lab).toHaveTextContent("test name: Hemoglobin · since: Sep 1, 2026");
    expect(lab).toHaveTextContent("Done");
    expect(profile).toHaveTextContent("Patient profile");
    expect(lab!.querySelector("details")).not.toHaveAttribute("open");

    await userEvent.setup().click(within(lab!).getByText("Lab results"));
    expect(lab!.querySelector("details")).toHaveAttribute("open");
    expect(lab!.querySelector("pre")?.textContent).toBe(JSON.stringify(labCall.output, null, 2));
  });

  it("marks running and failed calls", () => {
    render(
      <ChatToolCalls
        calls={[
          { id: "t1", name: "get_vitals_trend", input: { vital_type: "heart_rate" }, isError: false },
          { id: "t2", name: "get_lab_results", input: {}, output: "Patient p9 not found.", isError: true },
        ]}
        running={new Set(["t1"])}
      />,
    );

    const [running, failed] = screen.getAllByRole("listitem");
    expect(running).toHaveClass("running");
    expect(running).toHaveTextContent("Running…");
    expect(running).toHaveTextContent("Waiting for the result…");
    expect(failed).toHaveClass("failed");
    expect(failed).toHaveTextContent("Failed");
    expect(failed!.querySelector("pre")?.textContent).toBe("Patient p9 not found.");
  });

  it("shows unknown tools by name and shortens long results", () => {
    render(<ChatToolCalls calls={[{ id: "t1", name: "some_new_tool", input: {}, output: "x".repeat(MAX_OUTPUT_CHARS + 50), isError: false }]} />);

    expect(screen.getByText("some_new_tool")).toBeInTheDocument();
    const output = screen.getByRole("listitem").querySelector("pre")!.textContent!;
    expect(output).toBe(`${"x".repeat(MAX_OUTPUT_CHARS)}\n… (shortened)`);
  });
});
