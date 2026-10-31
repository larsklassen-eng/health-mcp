import { describe, expect, it, vi } from "vitest";

import { LocalReranker, type PairScorer, RerankerModelError } from "../src/index.js";

/** Scores a text by its length, so tests can predict the order. */
const lengthScorer = (): PairScorer => async (_query, texts) => texts.map((text) => text.length);

describe("LocalReranker", () => {
  it("scores passages in small batches and loads the model once", async () => {
    const scorer = vi.fn(lengthScorer());
    const createScorer = vi.fn(async () => scorer);
    const reranker = new LocalReranker({ createScorer, batchSize: 2 });

    expect(await reranker.rerank("q", ["a", "bbb", "cc", "dddd", "e"])).toEqual([1, 3, 2, 4, 1]);
    expect(await reranker.rerank("q", [])).toEqual([]);

    expect(createScorer).toHaveBeenCalledTimes(1);
    expect(scorer.mock.calls.map(([query, texts]) => [query, texts])).toEqual([
      ["q", ["a", "bbb"]],
      ["q", ["cc", "dddd"]],
      ["q", ["e"]],
    ]);
  });

  it("rejects a model that returns the wrong number of scores", async () => {
    const reranker = new LocalReranker({ createScorer: async () => async () => [1] });

    await expect(reranker.rerank("q", ["a", "b"])).rejects.toThrow("returned 1 scores for 2");
  });

  it("explains a model that cannot be loaded, and tries again on the next call", async () => {
    const createScorer = vi
      .fn<() => Promise<PairScorer>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(lengthScorer());
    const reranker = new LocalReranker({ createScorer });

    const failure = reranker.rerank("q", ["a"]);
    await expect(failure).rejects.toBeInstanceOf(RerankerModelError);
    await expect(failure).rejects.toThrow("Run `yarn rag:model`");
    expect(await reranker.rerank("q", ["abc"])).toEqual([3]);
  });
});
