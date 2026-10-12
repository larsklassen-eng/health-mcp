import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite's default transformer cannot compile NestJS parameter decorators
  // (`@Body()`, `@Param()`), so tests are compiled with SWC, which supports
  // legacy decorators and the metadata Nest uses for dependency injection.
  plugins: [swc.vite({ module: { type: "es6" } })],
  oxc: false,
  test: {
    // Tests never touch data/health.db and never call the real OpenRouter API,
    // even if these variables are set in the developer's shell.
    env: { DATABASE_PATH: ":memory:", OPENROUTER_API_KEY: "" },
  },
});
