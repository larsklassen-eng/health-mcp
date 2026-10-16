import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  // Links open in a new tab and send no referrer.
  a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Images are never loaded: a model-written image URL could carry patient data to another server.
  img: ({ alt }) => <span className="muted">[image not shown{alt ? `: ${alt}` : ""}]</span>,
  // Wide tables scroll inside the message instead of stretching it.
  table: ({ node: _, ...props }) => (
    <div className="markdown-table">
      <table {...props} />
    </div>
  ),
};

/**
 * Renders an assistant message written in Markdown (GitHub flavor: bold,
 * italics, lists, tables, code). Raw HTML in the text is not rendered.
 */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-content markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </Markdown>
    </div>
  );
}
