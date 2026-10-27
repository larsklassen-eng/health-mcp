import { HashingEmbedder, LocalEmbedder } from "@health-mcp/rag";
import { Global, Module } from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { EMBEDDER, IndexingService } from "./indexing.service.js";

/** Indexing for RAG. `RAG_EMBEDDER` picks the model: the local one, a test stand-in, or none. */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.RAG_EMBEDDER === "local"
          ? new LocalEmbedder()
          : env.RAG_EMBEDDER === "hashing"
            ? new HashingEmbedder()
            : null,
    },
    IndexingService,
  ],
  exports: [EMBEDDER, IndexingService],
})
export class RagModule {}
