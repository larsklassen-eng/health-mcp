import {
  OpenInferenceSpanKind,
  SemanticConventions as SC,
} from "@arizeai/openinference-semantic-conventions";
import { type Attributes, type Span, SpanStatusCode, trace } from "@opentelemetry/api";

/*
 * Tracing for search and indexing, in OpenInference's conventions so Phoenix
 * shows searches as retrievals with their passages (see docs/rag.md). Uses
 * only the OpenTelemetry API: without a tracer provider (see
 * start-tracing.ts) every span is a no-op.
 */

/**
 * Looked up for each span, not once at import: this module loads before an
 * app registers its tracer provider, and a tracer taken earlier can stay a
 * no-op (for one, when the OpenTelemetry API is loaded both as ESM and CJS).
 */
const tracer = () => trace.getTracer("@health-mcp/rag");

/** Runs `fn` in a span of the given OpenInference kind, recording errors. */
export function inSpan<T>(
  name: string,
  kind: OpenInferenceSpanKind,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  return tracer().startActiveSpan(
    name,
    { attributes: { [SC.OPENINFERENCE_SPAN_KIND]: kind, ...attributes } },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export interface TracedDocument {
  id: string | number;
  content?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/** Documents as flat attributes: `<prefix>.<i>.document.id`, `.content`, `.score`, `.metadata`. */
export function documentAttributes(prefix: string, documents: TracedDocument[]): Attributes {
  const attributes: Attributes = {};
  documents.forEach(({ id, content, score, metadata }, i) => {
    const at = `${prefix}.${i}.`;
    attributes[at + SC.DOCUMENT_ID] = String(id);
    if (content !== undefined) attributes[at + SC.DOCUMENT_CONTENT] = content;
    if (score !== undefined) attributes[at + SC.DOCUMENT_SCORE] = score;
    if (metadata) attributes[at + SC.DOCUMENT_METADATA] = JSON.stringify(metadata);
  });
  return attributes;
}

/** Texts sent to an embedding model, as `embedding.embeddings.<i>.embedding.text`. */
export function embeddingTextAttributes(model: string, texts: readonly string[]): Attributes {
  const attributes: Attributes = { [SC.EMBEDDING_MODEL_NAME]: model };
  texts.forEach((text, i) => {
    attributes[`${SC.EMBEDDING_EMBEDDINGS}.${i}.${SC.EMBEDDING_TEXT}`] = text;
  });
  return attributes;
}

export { OpenInferenceSpanKind as SpanKind, SC };
