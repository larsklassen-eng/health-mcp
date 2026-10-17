import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatTranscript } from "@/app/patients/[id]/chat/chat-transcript";

const message = {
  id: "m1",
  patientId: "p1",
  role: "assistant" as const,
  content: "Line one\nLine two",
  toolCalls: [],
  createdAt: "2026-10-01T22:30:00.000Z",
};

describe("ChatTranscript", () => {
  it("shows an empty state when there are no messages", () => {
    render(<ChatTranscript messages={[]} />);
    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("labels each message with its author and UTC time", () => {
    render(<ChatTranscript messages={[{ ...message, id: "m0", role: "user", content: "Hi" }, message]} />);

    const [userItem, assistantItem] = screen.getAllByRole("listitem");
    expect(userItem).toHaveClass("user");
    expect(within(userItem!).getByText("You")).toBeInTheDocument();
    expect(within(assistantItem!).getByText("Assistant")).toBeInTheDocument();
    const time = within(assistantItem!).getByText("Oct 1, 2026, 10:30 PM UTC");
    expect(time).toHaveAttribute("dateTime", "2026-10-01T22:30:00.000Z");
  });

  it("shows the user's messages as plain text, keeping line breaks and Markdown characters", () => {
    render(<ChatTranscript messages={[{ ...message, role: "user", content: "Line one\n**not bold**" }]} />);

    const content = screen.getByText(/Line one/);
    expect(content).toHaveClass("chat-content");
    expect(content.textContent).toBe("Line one\n**not bold**");
    expect(content.querySelector("strong")).toBeNull();
  });

  it("renders the assistant's messages as Markdown", () => {
    render(<ChatTranscript messages={[{ ...message, content: "**Stable** at the last MRI.\n\n- one\n- two" }]} />);

    expect(screen.getByText("Stable").tagName).toBe("STRONG");
    const item = screen.getByText("Stable").closest(".chat-message")!;
    expect(item.querySelectorAll(".markdown ul > li")).toHaveLength(2);
  });

  it("shows the assistant's tool calls above the answer, but none for the user", () => {
    const toolCalls = [{ id: "t1", name: "get_patient_profile", input: {}, output: { id: "p1" }, isError: false }];
    render(
      <ChatTranscript
        messages={[
          { ...message, id: "m0", role: "user", content: "Hi" },
          { ...message, content: "Answer", toolCalls },
        ]}
      />,
    );

    const lists = screen.getAllByRole("list", { name: "Data the assistant used" });
    expect(lists).toHaveLength(1);
    const item = lists[0]!.closest(".chat-message")!;
    expect(item).toHaveClass("assistant");
    expect(lists[0]!.compareDocumentPosition(item.querySelector(".markdown")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
