import { loadEnvFile } from "@health-mcp/db";

// Imported first by main.ts so the repo-root .env is loaded before anything reads process.env.
loadEnvFile();
