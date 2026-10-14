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

  it("keeps the line breaks of the message text", () => {
    render(<ChatTranscript messages={[message]} />);
    expect(screen.getByText(/Line one/).textContent).toBe("Line one\nLine two");
  });
});
