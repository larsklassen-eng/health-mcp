import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests never touch data/health.db, even if DATABASE_PATH is set in the developer's shell.
    env: { DATABASE_PATH: ":memory:" },
  },
});
