import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { HttpMcpClient } from "./http-mcp-client.js";
import { McpClient } from "./mcp-client.js";

/** Provides {@link McpClient}. Tests override it with a fake via the `McpClient` token. */
@Global()
@Module({
  providers: [
    {
      provide: McpClient,
      inject: [ENV],
      useFactory: (env: Env) =>
        new HttpMcpClient({ url: env.MCP_URL, authToken: env.MCP_AUTH_TOKEN }),
    },
  ],
  exports: [McpClient],
})
export class McpModule implements OnApplicationShutdown {
  constructor(@Inject(McpClient) private readonly client: McpClient) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client instanceof HttpMcpClient) await this.client.close();
  }
}
