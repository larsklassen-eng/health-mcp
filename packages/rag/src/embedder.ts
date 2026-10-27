import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Embeddings for RAG: text in, a unit-length vector out. Similar meaning gives
 * vectors pointing in similar directions, so the cosine distance between a
 * question and a chunk ranks the chunks.
 */

export interface Embedder {
  /** Model name, e.g. `Xenova/bge-small-en-v1.5`. */
  readonly model: string;
  /** Length of every vector; must match the `vec_chunks` table. */
  readonly dimensions: number;
  /** Embeds stored text (chunks). */
  embedDocuments(texts: readonly string[]): Promise<Float32Array[]>;
  /** Embeds a search query. Some models embed queries differently from documents. */
  embedQuery(text: string): Promise<Float32Array>;
}

/** Small English model: 384 dimensions, 34 MB quantized, runs on the CPU. */
export const DEFAULT_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;

/** BGE models match short questions to passages better with this instruction in front. */
export const BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

/** `data/models` at the repo root (git-ignored); `RAG_MODEL_DIR` overrides it. */
export const resolveModelDir = (env: { RAG_MODEL_DIR?: string | undefined } = process.env) =>
  path.resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
    env.RAG_MODEL_DIR ?? "data/models",
  );

/** The part of a transformers.js feature-extraction pipeline the embedder uses. */
export type Extractor = (
  texts: string[],
  options: { pooling: "cls"; normalize: true },
) => Promise<{ tolist(): number[][] }>;

export interface LocalEmbedderOptions {
  model?: string;
  dimensions?: number;
  /** Where model files are stored; defaults to {@link resolveModelDir}. */
  cacheDir?: string;
  /** Download the model when it is not in `cacheDir` (default true). */
  allowDownload?: boolean;
  /** Texts embedded per model call. */
  batchSize?: number;
  /** Replaces the model, for tests. */
  createExtractor?: () => Promise<Extractor>;
}

export class EmbeddingModelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingModelError";
  }
}

/**
 * Runs an embedding model on this machine with transformers.js (ONNX). No
 * text leaves the machine. The model is loaded on first use and then kept.
 */
export class LocalEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;
  private readonly batchSize: number;
  private readonly createExtractor: () => Promise<Extractor>;
  private extractor: Promise<Extractor> | undefined;

  constructor(options: LocalEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
    this.batchSize = options.batchSize ?? 32;
    const cacheDir = options.cacheDir ?? resolveModelDir();
    const allowDownload = options.allowDownload ?? true;
    this.createExtractor =
      options.createExtractor ??
      (async () => {
        const { env, pipeline } = await import("@huggingface/transformers");
        env.cacheDir = cacheDir;
        env.allowRemoteModels = allowDownload;
        // Quantized (8-bit) weights: a quarter of the size, nearly the same quality.
        const extract = await pipeline("feature-extraction", this.model, { dtype: "q8" });
        return (texts, pooling) => extract(texts, pooling);
      });
  }

  /** Loads the model now (it otherwise loads on first use). */
  async load(): Promise<void> {
    await this.getExtractor();
  }

  async embedDocuments(texts: readonly string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += this.batchSize)
      vectors.push(...(await this.embed(texts.slice(start, start + this.batchSize))));
    return vectors;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vector] = await this.embed([BGE_QUERY_INSTRUCTION + text]);
    return vector!;
  }

  private getExtractor(): Promise<Extractor> {
    this.extractor ??= this.createExtractor().catch((cause: unknown) => {
      this.extractor = undefined; // let a later call try again
      throw new EmbeddingModelError(
        `Could not load the embedding model ${this.model}. Run \`yarn rag:model\` to download it.`,
        { cause },
      );
    });
    return this.extractor;
  }

  private async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extract = await this.getExtractor();
    // BGE models use the first token's output (CLS pooling), normalized to unit length.
    const output = (await extract(texts, { pooling: "cls", normalize: true })).tolist();
    return output.map((values) => {
      if (values.length !== this.dimensions)
        throw new EmbeddingModelError(
          `${this.model} returned ${values.length} dimensions; expected ${this.dimensions}`,
        );
      return Float32Array.from(values);
    });
  }
}

/**
 * Embeds by hashing words into buckets: texts that share words get similar
 * vectors. No model and no download, so tests are fast and deterministic. It
 * knows nothing about meaning ("head pain" does not match "headache"), so it is
 * for tests only.
 */
export class HashingEmbedder implements Embedder {
  readonly model = "hashing";

  constructor(readonly dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {}

  async embedDocuments(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.vector(text));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return this.vector(text);
  }

  private vector(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      // FNV-1a hash of the word picks its bucket.
      let hash = 2166136261;
      for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      vector[(hash >>> 0) % this.dimensions]! += 1;
    }
    const length = Math.hypot(...vector);
    return length === 0 ? vector : vector.map((value) => value / length);
  }
}
