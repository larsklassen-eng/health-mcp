import { LocalEmbedder, resolveModelDir } from "../embedder.js";
import { LocalReranker } from "../reranker.js";

/*
 * Downloads the embedding model (about 34 MB) and the reranker (about 87 MB)
 * into data/models, once, so indexing and search later work offline.
 * Usage: `yarn rag:model`.
 */
const embedder = new LocalEmbedder();
let started = performance.now();
const [vector] = await embedder.embedDocuments(["Synthetic test sentence."]);
const seconds = () => ((performance.now() - started) / 1000).toFixed(1);
console.log(`${embedder.model} is ready (${seconds()} s, ${vector!.length} dimensions)`);

const reranker = new LocalReranker();
started = performance.now();
await reranker.rerank("test", ["Synthetic test sentence."]);
console.log(`${reranker.model} is ready (${seconds()} s)`);
console.log(`Models are in ${resolveModelDir()}`);
