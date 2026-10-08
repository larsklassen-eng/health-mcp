import { z } from "zod";

/** Response body of `GET /health`, served by apps/api and apps/mcp-server. */
export const HealthCheckResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  timestamp: z.iso.datetime(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
