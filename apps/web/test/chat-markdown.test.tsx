import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMarkdown } from "@/app/patients/[id]/chat/chat-markdown";

const renderMarkdown = (text: string) => render(<ChatMarkdown text={text} />).container.firstElementChild as HTMLElement;

describe("ChatMarkdown", () => {
  it("renders bold, italics and inline code", () => {
    renderMarkdown("**Stable** disease, *no* new `enhancement`.");

    expect(screen.getByText("Stable").tagName).toBe("STRONG");
    expect(screen.getByText("no").tagName).toBe("EM");
    expect(screen.getByText("enhancement").tagName).toBe("CODE");
  });

  it("renders headings, paragraphs and nested lists", () => {
    const root = renderMarkdown("### Treatment\n\nSo far:\n\n- Resection\n- Chemoradiation\n  - 60 Gy\n\n1. First\n2. Second");

    expect(screen.getByRole("heading", { level: 3, name: "Treatment" })).toBeInTheDocument();
    expect(root.querySelectorAll(":scope > ul > li")).toHaveLength(2);
    expect(root.querySelector("ul ul li")).toHaveTextContent("60 Gy");
    expect(root.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it("renders GitHub-style tables inside a scroll container", () => {
    const root = renderMarkdown("| Test | 10-05 | 10-12 |\n|---|---|---|\n| Platelets | **121 (L)** | 168 |");

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("markdown-table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Test", "10-05", "10-12"]);
    expect(within(table).getByText("121 (L)").tagName).toBe("STRONG");
    expect(root).not.toHaveTextContent("|---|");
  });

  it("does not render raw HTML", () => {
    const root = renderMarkdown('Before <script>alert(1)</script><b onclick="x()">bold</b> after');

    // The tags are dropped; their inner text stays as plain, harmless text.
    expect(root.querySelector("script, b, [onclick]")).toBeNull();
    expect(root.innerHTML).toBe('<p>Before alert(1)bold after</p>');
  });

  it("never loads images, showing their description instead", () => {
    const root = renderMarkdown("![latest MRI](https://example.com/collect?data=secret) and ![](https://example.com/x.png)");

    expect(root.querySelector("img")).toBeNull();
    expect(root).toHaveTextContent("[image not shown: latest MRI] and [image not shown]");
    expect(root.innerHTML).not.toContain("example.com");
  });

  it("opens links in a new tab without a referrer and drops javascript: URLs", () => {
    renderMarkdown("[guideline](https://example.org/gbm) and [bad](javascript:alert(1))");

    expect(screen.getByRole("link", { name: "guideline" })).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
    expect(screen.getByText("bad").closest("a")?.getAttribute("href") ?? "").not.toContain("javascript");
  });
});
