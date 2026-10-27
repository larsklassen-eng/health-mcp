import { describe, expect, it, vi } from "vitest";

import {
  BGE_QUERY_INSTRUCTION,
  EmbeddingModelError,
  type Extractor,
  HashingEmbedder,
  LocalEmbedder,
} from "../src/index.js";

/** A stand-in model: records each call and returns a 3-dimensional vector per text. */
function fakeModel(dimensions = 3) {
  const calls: string[][] = [];
  const extractor: Extractor = async (texts) => {
    calls.push(texts);
    return { tolist: () => texts.map((_, i) => Array.from({ length: dimensions }, () => i)) };
  };
  return { calls, createExtractor: vi.fn(async () => extractor) };
}

const cosine = (a: Float32Array, b: Float32Array) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

describe("LocalEmbedder", () => {
  it("embeds documents in batches and loads the model once", async () => {
    const model = fakeModel();
    const embedder = new LocalEmbedder({ dimensions: 3, batchSize: 2, ...model });

    const vectors = await embedder.embedDocuments(["a", "b", "c", "d", "e"]);
    await embedder.embedDocuments(["f"]);

    expect(vectors).toHaveLength(5);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(model.calls).toEqual([["a", "b"], ["c", "d"], ["e"], ["f"]]);
    expect(model.createExtractor).toHaveBeenCalledOnce();
  });

  it("puts the search instruction in front of queries only", async () => {
    const model = fakeModel();
    const embedder = new LocalEmbedder({ dimensions: 3, ...model });

    await embedder.embedQuery("has she had head pain?");
    await embedder.embedDocuments(["Headache."]);

    expect(model.calls).toEqual([
      [`${BGE_QUERY_INSTRUCTION}has she had head pain?`],
      ["Headache."],
    ]);
  });

  it("does not load the model for nothing", async () => {
    const model = fakeModel();

    expect(await new LocalEmbedder({ dimensions: 3, ...model }).embedDocuments([])).toEqual([]);
    expect(model.createExtractor).not.toHaveBeenCalled();
  });

  it("rejects vectors of the wrong size, which the database could not store", async () => {
    const embedder = new LocalEmbedder({ dimensions: 384, ...fakeModel(3) });

    await expect(embedder.embedQuery("x")).rejects.toThrow("returned 3 dimensions; expected 384");
  });

  it("explains a model that cannot be loaded, and tries again on the next call", async () => {
    const working = fakeModel();
    const createExtractor = vi
      .fn<() => Promise<Extractor>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(working.createExtractor);
    const embedder = new LocalEmbedder({ dimensions: 3, createExtractor });

    const failure = await embedder.embedQuery("x").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbeddingModelError);
    expect((failure as Error).message).toContain("yarn rag:model");

    await expect(embedder.embedQuery("x")).resolves.toHaveLength(3);
  });
});

describe("HashingEmbedder", () => {
  const embedder = new HashingEmbedder();

  it("returns unit-length vectors that are the same for the same text", async () => {
    const [a, b] = await embedder.embedDocuments(["Mild headache", "Mild headache"]);

    expect(a).toHaveLength(384);
    expect(cosine(a!, a!)).toBeCloseTo(1);
    expect(a).toEqual(b);
  });

  it("scores texts that share words higher, ignoring case", async () => {
    const query = await embedder.embedQuery("HEADACHE in the morning");
    const [headache, platelets] = await embedder.embedDocuments([
      "Headache every morning",
      "Platelets were low",
    ]);

    expect(cosine(query, headache!)).toBeGreaterThan(cosine(query, platelets!));
  });

  it("returns a zero vector for text without words", async () => {
    expect([...(await embedder.embedQuery("!!"))].every((value) => value === 0)).toBe(true);
  });
});
