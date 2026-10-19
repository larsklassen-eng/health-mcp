import { tmpdir } from "node:os";
import path from "node:path";

import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite's default transformer cannot compile NestJS parameter decorators
  // (`@Body()`, `@Param()`), so tests are compiled with SWC, which supports
  // legacy decorators and the metadata Nest uses for dependency injection.
  plugins: [swc.vite({ module: { type: "es6" } })],
  oxc: false,
  test: {
    // Tests never touch data/health.db and never call the real OpenRouter API or
    // MCP server, even if these variables are set in the developer's shell.
    env: {
      DATABASE_PATH: ":memory:",
      // Uploaded images go to a temporary folder, never to data/imaging.
      IMAGING_DIR: path.join(tmpdir(), "health-mcp-api-tests", "imaging"),
      OPENROUTER_API_KEY: "",
      MCP_AUTH_TOKEN: "",
      MCP_URL: "http://127.0.0.1:9/mcp",
    },
  },
});
