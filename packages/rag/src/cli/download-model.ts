import { LocalEmbedder, resolveModelDir } from "../embedder.js";

/*
 * Downloads the embedding model into data/models (once, about 34 MB), so
 * indexing and search later work offline. Usage: `yarn rag:model`.
 */
const embedder = new LocalEmbedder();
const started = performance.now();
await embedder.load();
const [vector] = await embedder.embedDocuments(["Synthetic test sentence."]);
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`${embedder.model} is ready in ${resolveModelDir()}`);
console.log(`(${seconds} s, ${vector!.length} dimensions)`);
