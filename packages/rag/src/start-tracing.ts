import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export interface TracingOptions {
  /** Phoenix's address, e.g. `http://localhost:6006`; traces go to `<endpoint>/v1/traces`. */
  endpoint: string;
  /** Which app sends the traces, e.g. `mcp-server`. */
  serviceName: string;
  /** Phoenix project the traces are grouped under. */
  projectName?: string;
  /** Phoenix API key, when its login is on (as in AWS); sent as a bearer token. */
  apiKey?: string | undefined;
}

/**
 * Sends this process's spans (search and indexing, see telemetry.ts) to
 * Phoenix over OTLP. Call once at startup, only when a collector is set:
 * spans carry patients' text, so they must go to a Phoenix on this machine
 * (locally, or the one beside the app in AWS, behind its login).
 * `shutdown` sends what is still buffered.
 */
export function startTracing({
  endpoint,
  serviceName,
  projectName = "health-mcp",
  apiKey,
}: TracingOptions): { shutdown: () => Promise<void> } {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      [SEMRESATTRS_PROJECT_NAME]: projectName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
          ...(apiKey && { headers: { Authorization: `Bearer ${apiKey}` } }),
        }),
      ),
    ],
  });
  provider.register();
  return { shutdown: () => provider.shutdown() };
}
