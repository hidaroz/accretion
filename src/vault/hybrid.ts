// Reciprocal-rank fusion (RRF) for hybrid retrieval — combine keyword +
// semantic rankings into one. Cheap, explainable, deterministic; the reviewer's
// recommended first step before any cross-encoder reranking.

export interface RrfOptions {
  /** RRF damping constant (standard default 60). */
  k?: number;
  /** Optional per-path score multiplier, e.g. demote raw session notes. */
  weight?: (path: string) => number;
}

/**
 * Fuse N ranked path lists by Σ 1/(k + rank). Items ranked well in multiple
 * lists rise; complementary hits from either list are recovered. Ties break
 * lexicographically for determinism. Pure.
 */
export function rrf(lists: string[][], options: RrfOptions = {}): string[] {
  const k = options.k ?? 60;
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((path, i) => {
      score.set(path, (score.get(path) ?? 0) + 1 / (k + i + 1));
    });
  }
  if (options.weight) {
    for (const [path, s] of score) score.set(path, s * options.weight(path));
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => path);
}

/** Raw session journals (not digests) — de-prioritized for durable answers. */
export function isRawSession(path: string): boolean {
  return path.startsWith("sessions/") && !path.startsWith("sessions/digests/");
}

interface KeywordSearcher {
  search(query: string, opts?: { limit?: number }): Array<{ path: string }>;
}
interface SemanticSearcher {
  search(query: string, limit?: number): Promise<Array<{ path: string }>>;
}

/**
 * Hybrid retrieval: RRF over keyword + semantic, with raw sessions demoted so
 * briefs/knowledge/digests surface first for durable answers. Returns up to
 * `limit` note paths. Each index is queried wider (limit*3) before fusion.
 */
export async function hybridSearch(
  keyword: KeywordSearcher,
  semantic: SemanticSearcher | null,
  query: string,
  limit = 8
): Promise<string[]> {
  const wide = limit * 3;
  const kw = keyword.search(query, { limit: wide }).map((r) => r.path);

  let sem: string[] = [];
  if (semantic) {
    const seen = new Set<string>();
    for (const r of await semantic.search(query, wide)) {
      if (!seen.has(r.path)) {
        seen.add(r.path);
        sem.push(r.path);
      }
    }
  }

  const fused = rrf([kw, sem], {
    weight: (p) => (isRawSession(p) ? 0.7 : 1),
  });
  return fused.slice(0, limit);
}
