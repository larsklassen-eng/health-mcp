import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_RERANKER_MODEL,
  LocalEmbedder,
  LocalReranker,
  resolveModelDir,
} from "../src/index.js";

/*
 * Runs the real model, but only where it is already downloaded (`yarn
 * rag:model`), so CI and fresh clones never download it during tests.
 */
const downloaded = existsSync(path.join(resolveModelDir(), DEFAULT_EMBEDDING_MODEL));
const rerankerDownloaded = existsSync(path.join(resolveModelDir(), DEFAULT_RERANKER_MODEL));
const cosine = (a: Float32Array, b: Float32Array) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

describe.runIf(downloaded)("LocalEmbedder with the real model", () => {
  const embedder = new LocalEmbedder({ allowDownload: false });

  it("finds the passage with the same meaning, even without shared words", async () => {
    const query = await embedder.embedQuery("Has she had any head pain?");
    const passages = await embedder.embedDocuments([
      "Symptom: mild headache in the morning, severity 3/10.",
      "Platelets were low at 139 x10^3/uL.",
      "Walked 30 minutes without resting.",
    ]);

    const scores = passages.map((passage) => cosine(query, passage));

    expect(passages[0]).toHaveLength(384);
    expect(cosine(passages[0]!, passages[0]!)).toBeCloseTo(1, 4);
    expect(scores.indexOf(Math.max(...scores))).toBe(0);
  }, 60_000);
});

describe.runIf(rerankerDownloaded)("LocalReranker with the real model", () => {
  const reranker = new LocalReranker({ allowDownload: false });

  it("ranks the passage that answers a clinical term first, sharing no words", async () => {
    const passages = [
      "Symptom (2026-09-24): Headache, severity 5/10.",
      "Symptom (2026-09-25): Right arm numbness, severity 4/10. Pins and needles in the hand.",
      "Imaging report: CT head without contrast. No hemorrhage after left parietal resection.",
    ];

    const scores = await reranker.rerank("paresthesia", passages);

    expect(scores).toHaveLength(3);
    expect(scores.indexOf(Math.max(...scores))).toBe(1);
  }, 60_000);
});
