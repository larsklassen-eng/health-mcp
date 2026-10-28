import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests never touch data/health.db, even if DATABASE_PATH is set in the developer's shell.
    // Search uses a word-hashing stand-in, never the real embedding model.
    env: { DATABASE_PATH: ":memory:", RAG_EMBEDDER: "hashing" },
  },
});
