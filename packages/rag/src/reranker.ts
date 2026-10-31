import { resolveModelDir } from "./embedder.js";

/*
 * Reranking for RAG: a cross-encoder reads the question and one passage
 * together and scores how well the passage answers it. That is sharper than
 * comparing two separate embeddings ("paresthesia" finds "pins and needles"),
 * but slower, so it only re-scores the few candidates hybrid search found.
 */

export interface Reranker {
  /** Model name, e.g. `mixedbread-ai/mxbai-rerank-xsmall-v1`. */
  readonly model: string;
  /** One score per text, higher is more relevant; only comparable within one call. */
  rerank(query: string, texts: readonly string[]): Promise<number[]>;
}

/**
 * Small English cross-encoder (DeBERTa-v3, 87 MB quantized). Chosen by
 * measurement on the retrieval checks (docs/rag.md): it found every expected
 * passage, where MiniLM, TinyBERT, jina-tiny and bge-reranker-base did not.
 * It needs about 550 MB of memory once loaded.
 */
export const DEFAULT_RERANKER_MODEL = "mixedbread-ai/mxbai-rerank-xsmall-v1";

/** Scores (query, text) pairs; one model call. */
export type PairScorer = (query: string, texts: string[]) => Promise<number[]>;

export interface LocalRerankerOptions {
  model?: string;
  /** Where model files are stored; defaults to the embedding model's folder. */
  cacheDir?: string;
  /** Download the model when it is not in `cacheDir` (default true). */
  allowDownload?: boolean;
  /** Pairs scored per model call; small batches keep memory down. */
  batchSize?: number;
  /** Replaces the model, for tests. */
  createScorer?: () => Promise<PairScorer>;
}

export class RerankerModelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RerankerModelError";
  }
}

/** Longest question plus passage the model reads, in tokens (chunks are about 200). */
const MAX_TOKENS = 512;

/** Runs a cross-encoder on this machine with transformers.js; loaded on first use. */
export class LocalReranker implements Reranker {
  readonly model: string;
  private readonly batchSize: number;
  private readonly createScorer: () => Promise<PairScorer>;
  private scorer: Promise<PairScorer> | undefined;

  constructor(options: LocalRerankerOptions = {}) {
    this.model = options.model ?? DEFAULT_RERANKER_MODEL;
    this.batchSize = options.batchSize ?? 5;
    const cacheDir = options.cacheDir ?? resolveModelDir();
    const allowDownload = options.allowDownload ?? true;
    this.createScorer =
      options.createScorer ??
      (async () => {
        const { env, AutoTokenizer, AutoModelForSequenceClassification } =
          await import("@huggingface/transformers");
        env.cacheDir = cacheDir;
        env.allowRemoteModels = allowDownload;
        const tokenizer = await AutoTokenizer.from_pretrained(this.model);
        const classifier = await AutoModelForSequenceClassification.from_pretrained(this.model, {
          dtype: "q8",
          // Without ONNX Runtime's memory pools the model needs a little less memory.
          session_options: { enableCpuMemArena: false, enableMemPattern: false },
        });
        return async (query, texts) => {
          const inputs = tokenizer(new Array<string>(texts.length).fill(query), {
            text_pair: texts,
            padding: true,
            truncation: true,
            max_length: MAX_TOKENS,
          });
          const { logits } = (await classifier(inputs)) as { logits: { tolist(): number[][] } };
          return logits.tolist().map(([score]) => score!);
        };
      });
  }

  /** Loads the model now (it otherwise loads on first use). */
  async load(): Promise<void> {
    await this.getScorer();
  }

  async rerank(query: string, texts: readonly string[]): Promise<number[]> {
    const scores: number[] = [];
    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts.slice(start, start + this.batchSize);
      const batchScores = await (await this.getScorer())(query, batch);
      if (batchScores.length !== batch.length)
        throw new RerankerModelError(
          `${this.model} returned ${batchScores.length} scores for ${batch.length} passages`,
        );
      scores.push(...batchScores);
    }
    return scores;
  }

  private getScorer(): Promise<PairScorer> {
    this.scorer ??= this.createScorer().catch((cause: unknown) => {
      this.scorer = undefined; // let a later call try again
      throw new RerankerModelError(
        `Could not load the reranker model ${this.model}. Run \`yarn rag:model\` to download it.`,
        { cause },
      );
    });
    return this.scorer;
  }
}
