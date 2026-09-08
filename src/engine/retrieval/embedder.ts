import type { Embedder } from "./embedding-index.js";
import { logger } from "../utils/logger.js";
import { expandHome } from "../utils/path-safety.js";

// All inference is local. Model weights download once from the HF hub and are
// cached on disk; nothing leaves the machine at query time. For locked-down
// environments, pre-seed the cache and set TRANSFORMERS_OFFLINE / a local model
// path, or point EMBEDDING_MODEL at a vendored model directory.
//
// The library is imported on first use, not at module load: keyword-only
// callers (the recall hook, most CLI calls) must not pay for or depend on it,
// and the bundled hooks list it as external.
const MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";

type Extractor = (
  input: string[],
  opts: { pooling: "mean"; normalize: boolean }
) => Promise<{ tolist: () => number[][] }>;

/**
 * A local sentence-embedding function backed by transformers.js. Returns
 * L2-normalized vectors, so cosine == dot product.
 */
export function createLocalEmbedder(): Embedder {
  let extractorPromise: Promise<Extractor> | null = null;

  const getExtractor = () => {
    if (!extractorPromise) {
      logger.info(`Loading embedding model ${MODEL} (first use)…`);
      extractorPromise = import("@xenova/transformers").then(({ pipeline, env }) => {
        if (process.env.TRANSFORMERS_CACHE) {
          // Unexpanded, a leading `~` here creates a literal `~` directory in cwd and
          // silently re-downloads the model on every run from a different directory.
          env.cacheDir = expandHome(process.env.TRANSFORMERS_CACHE);
        }
        return pipeline("feature-extraction", MODEL) as unknown as Promise<Extractor>;
      });
    }
    return extractorPromise;
  };

  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const extractor = await getExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  };
}
