import type { ToolCall } from "@health-mcp/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ChatToolCalls,
  formatToolInput,
  MAX_OUTPUT_CHARS,
} from "@/app/patients/[id]/chat/chat-tool-calls";

const labCall: ToolCall = {
  id: "t1",
  name: "get_lab_results",
  input: { test_name: "Hemoglobin", since: "2026-09-01T00:00:00.000Z", limit: 20 },
  output: { results: [{ testName: "Hemoglobin", value: 11.2 }], hasMore: false },
  isError: false,
};

describe("formatToolInput", () => {
  it("lists the arguments in plain words, with dates in UTC", () => {
    expect(formatToolInput(labCall.input)).toBe(
      "test name: Hemoglobin · since: Sep 1, 2026 · limit: 20",
    );
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
    render(
      <ChatToolCalls
        calls={[
          labCall,
          {
            id: "t2",
            name: "get_patient_profile",
            input: {},
            output: { id: "p1" },
            isError: false,
          },
        ]}
      />,
    );

    const [lab, profile] = within(
      screen.getByRole("list", { name: "Data the assistant used" }),
    ).getAllByRole("listitem");
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
          {
            id: "t1",
            name: "get_vitals_trend",
            input: { vital_type: "heart_rate" },
            isError: false,
          },
          {
            id: "t2",
            name: "get_lab_results",
            input: {},
            output: "Patient p9 not found.",
            isError: true,
          },
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
    render(
      <ChatToolCalls
        calls={[
          {
            id: "t1",
            name: "some_new_tool",
            input: {},
            output: "x".repeat(MAX_OUTPUT_CHARS + 50),
            isError: false,
          },
        ]}
      />,
    );

    expect(screen.getByText("some_new_tool")).toBeInTheDocument();
    const output = screen.getByRole("listitem").querySelector("pre")!.textContent!;
    expect(output).toBe(`${"x".repeat(MAX_OUTPUT_CHARS)}\n… (shortened)`);
  });

  describe("entries that need confirmation", () => {
    const pending: ToolCall = {
      id: "t9",
      name: "log_symptom",
      input: { name: "Headache", severity: 4 },
      output: "Not saved yet.",
      isError: false,
      confirmation: "pending",
    };

    it("asks to save or discard, showing what will be saved", async () => {
      const onDecide = vi.fn().mockResolvedValue(undefined);
      render(<ChatToolCalls calls={[pending]} onDecide={onDecide} />);

      const item = screen.getByRole("listitem");
      expect(item).toHaveClass("pending");
      expect(item).toHaveTextContent("Log symptom");
      expect(item).toHaveTextContent("Needs your confirmation");
      expect(item).toHaveTextContent("Nothing was saved.");
      const group = screen.getByRole("group", { name: "Confirm entry" });
      expect(group).toHaveTextContent("name: Headache · severity: 4");

      await userEvent.setup().click(within(group).getByRole("button", { name: "Save" }));
      expect(onDecide).toHaveBeenCalledWith("t9", "confirm");
    });

    it("discards, and shows an error from the decision", async () => {
      const onDecide = vi
        .fn()
        .mockResolvedValue("The MCP server is not reachable. Nothing was saved.");
      render(<ChatToolCalls calls={[pending]} onDecide={onDecide} />);

      await userEvent.setup().click(screen.getByRole("button", { name: "Discard" }));

      expect(onDecide).toHaveBeenCalledWith("t9", "reject");
      expect(await screen.findByRole("alert")).toHaveTextContent("MCP server is not reachable");
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("disables the buttons while the answer streams, and hides them without a handler", () => {
      const { unmount } = render(
        <ChatToolCalls calls={[pending]} onDecide={vi.fn()} decisionsDisabled />,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
      unmount();

      render(<ChatToolCalls calls={[pending]} />);
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    });

    it("shows saved and discarded entries without buttons", () => {
      render(
        <ChatToolCalls
          calls={[
            {
              ...pending,
              id: "a",
              confirmation: "confirmed",
              output: { symptom: { name: "Headache" } },
            },
            { ...pending, id: "b", confirmation: "rejected" },
          ]}
          onDecide={vi.fn()}
        />,
      );

      const [saved, discarded] = screen.getAllByRole("listitem");
      expect(saved).toHaveTextContent("Saved");
      expect(saved!.querySelector("pre")).toHaveTextContent('"name": "Headache"');
      expect(discarded).toHaveTextContent("Discarded");
      expect(discarded).toHaveTextContent("Nothing was saved.");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
