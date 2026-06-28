// Shared brief-routing — one source of truth for get_brief, get_context, and
// the eval. Prefers "no brief" over "plausible but wrong": a fuzzy match must
// clear an absolute floor AND beat #2 by a ratio (intent) or it abstains.
// Exact evidence (brief-map route or exact title) routes without the threshold.

export interface BriefHit {
  path: string;
  title: string;
  score: number;
}

export interface BriefSearcher {
  search(
    query: string,
    opts?: { tag?: string; limit?: number }
  ): BriefHit[];
}

export type RouteMethod =
  | "direct_map"
  | "exact_title"
  | "tag_search"
  | "abstain";

export interface RouteResult {
  path: string | null;
  method: RouteMethod;
  score?: number;
  marginRatio?: number;
}

export interface RouteOptions {
  /** Minimum top score for a fuzzy match to be eligible (vault-scaled). */
  floor?: number;
  /** Top must beat #2 by this ratio to show intent (top/second ≥ marginRatio). */
  marginRatio?: number;
}

// Calibrated on the work eval (see evals/results + ADR-010). MiniSearch scores
// are vault-relative, so these may need per-vault tuning; the eval is the tool.
// Calibrated via the work routing sweep (66 cases): floor 8 + ratio 1.3 gives
// routing precision 98% and negative-routing 92% (from 37.5%) with positive
// routing recall held at 100%. See ADR-010 / evals/results.
export const DEFAULT_FLOOR = 8;
export const DEFAULT_MARGIN_RATIO = 1.3;

function norm(s: string): string {
  return s.toLowerCase().trim();
}

export function routeBrief(
  briefMap: Record<string, string>,
  searchIndex: BriefSearcher,
  topic: string,
  opts: RouteOptions = {}
): RouteResult {
  const floor = opts.floor ?? DEFAULT_FLOOR;
  const marginRatio = opts.marginRatio ?? DEFAULT_MARGIN_RATIO;
  const t = norm(topic);

  // 1. Explicit brief-map route — strongest evidence, no threshold.
  const mapped = briefMap[t];
  if (mapped) return { path: mapped.replace(/^\.\//, ""), method: "direct_map" };

  const hits = searchIndex.search(t, { tag: "type/brief", limit: 2 });
  if (hits.length === 0) return { path: null, method: "abstain" };

  const top = hits[0];

  // 2. Exact title match — high evidence, routes regardless of margin.
  if (norm(top.title) === t) {
    return { path: top.path, method: "exact_title", score: top.score };
  }

  // 3. Fuzzy tag_search — needs floor AND margin, else abstain.
  const second = hits[1]?.score ?? 0;
  const ratio = second > 0 ? top.score / second : Infinity;
  if (top.score >= floor && ratio >= marginRatio) {
    return {
      path: top.path,
      method: "tag_search",
      score: top.score,
      marginRatio: ratio === Infinity ? undefined : ratio,
    };
  }
  return {
    path: null,
    method: "abstain",
    score: top.score,
    marginRatio: ratio === Infinity ? undefined : ratio,
  };
}
