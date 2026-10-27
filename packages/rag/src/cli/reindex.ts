import { parseArgs } from "node:util";

import { createDb, loadEnvFile } from "@health-mcp/db";

import { LocalEmbedder } from "../embedder.js";
import { syncAllPatients } from "../sync.js";

/*
 * Brings the search index up to date for every patient: `yarn rag:reindex`.
 * With `--full`, deletes all chunks and embeds everything again (needed after
 * changing the embedding model or the chunk size).
 */
loadEnvFile();
const { values } = parseArgs({ options: { full: { type: "boolean" } } });
const connection = createDb();
const started = performance.now();
try {
  const totals = await syncAllPatients(connection.db, new LocalEmbedder(), {
    full: values.full ?? false,
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `${totals.patients} patients in ${seconds} s: ${totals.indexed} records indexed, ` +
      `${totals.removed} removed, ${totals.unchanged} unchanged (${connection.path})`,
  );
} finally {
  connection.close();
}
