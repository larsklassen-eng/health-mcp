import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    // Never call a real api from tests.
    env: { API_URL: "http://api.test" },
  },
});
