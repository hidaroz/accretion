import { SESSION_FUSION_WEIGHT } from "./weights.js";

// Reciprocal-rank fusion (RRF) for hybrid retrieval — combine keyword +
// semantic rankings into one. Cheap, explainable, deterministic; the reviewer's
// recommended first step before any cross-encoder reranking.

export interface RrfOptions {
  /** RRF damping constant (standard default 60). */
  k?: number;
  /** Optional per-path score multiplier, e.g. demote raw session notes. */
  weight?: (path: string) => number;
  /**
   * Paths to pin to the front if they were retrieved by any list — so a
   * canonical/exact keyword hit (slug/title/alias/brief-map route) can't be
   * demoted out of the top by fusion. Pins not in any list are ignored.
   */
  pins?: string[];
}

/**
 * Fuse N ranked path lists by Σ 1/(k + rank). Items ranked well in multiple
 * lists rise; complementary hits from either list are recovered. Ties break
 * lexicographically for determinism. `pins` that were retrieved are forced to
 * the front (in given order). Pure.
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
  const ranked = [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => path);

  const pins = (options.pins ?? []).filter((p) => score.has(p));
  if (pins.length === 0) return ranked;
  const pinned = new Set(pins);
  return [...pins, ...ranked.filter((p) => !pinned.has(p))];
}

/** Raw session journals (not digests) — de-prioritized for durable answers. */
export function isRawSession(path: string): boolean {
  return path.startsWith("sessions/") && !path.startsWith("sessions/digests/");
}

