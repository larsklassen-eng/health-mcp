import { Global, Module } from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { LlmClient } from "./llm-client.js";
import { OpenRouterLlmClient } from "./openrouter-llm-client.js";

/** Provides {@link LlmClient}. Tests override it with a fake via the `LlmClient` token. */
@Global()
@Module({
  providers: [
    {
      provide: LlmClient,
      inject: [ENV],
      useFactory: (env: Env) =>
        new OpenRouterLlmClient({
          apiKey: env.OPENROUTER_API_KEY,
          model: env.OPENROUTER_MODEL,
          maxTokens: env.LLM_MAX_TOKENS,
          zeroDataRetention: env.OPENROUTER_ZDR,
          promptCaching: env.OPENROUTER_PROMPT_CACHING,
          ...(env.OPENROUTER_BASE_URL !== undefined && { serverURL: env.OPENROUTER_BASE_URL }),
        }),
    },
  ],
  exports: [LlmClient],
})
export class LlmModule {}
