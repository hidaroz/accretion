import { pipeline, env } from "@xenova/transformers";
import type { Embedder } from "./embedding-index.js";
import { logger } from "../utils/logger.js";

// All inference is local. Model weights download once from the HF hub and are
// cached on disk; nothing leaves the machine at query time. For locked-down
// environments, pre-seed the cache and set TRANSFORMERS_OFFLINE / a local model
// path, or point EMBEDDING_MODEL at a vendored model directory.
const MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}

/**
 * A local sentence-embedding function backed by transformers.js. The model is
 * loaded lazily on first call (so server startup and the test suite never pay
 * for it unless embeddings are actually used). Returns L2-normalized vectors,
 * so cosine == dot product.
 */
export function createLocalEmbedder(): Embedder {
  let extractorPromise: Promise<unknown> | null = null;

  const getExtractor = () => {
    if (!extractorPromise) {
      logger.info(`Loading embedding model ${MODEL} (first use)…`);
      extractorPromise = pipeline("feature-extraction", MODEL);
    }
    return extractorPromise;
  };

  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const extractor = (await getExtractor()) as (
      input: string[],
      opts: { pooling: "mean"; normalize: boolean }
    ) => Promise<{ tolist: () => number[][] }>;
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  };
}
