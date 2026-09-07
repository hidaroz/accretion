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

// Calibrated against demo-vault/ (see evals/results/). MiniSearch scores
// are vault-relative, so these may need per-vault tuning; the eval is the tool.
// A modest floor + margin keep obviously-weak/ambiguous matches out; the
// domain-trigger guard (below) does the real precision work, so we deliberately
// DON'T crank the global floor (which would quietly kill legitimate fuzzy routes).
// Run `memory-eval.mjs --sweep-routing` against your own vault to re-derive these.
export const DEFAULT_FLOOR = 4;
export const DEFAULT_MARGIN_RATIO = 1.3;

function norm(s: string): string {
  return s.toLowerCase().trim();
}

// Tokenization for the domain-trigger guard. The stopword set is for tokenizing
// only (drop "how/what/the"), NOT a domain blocklist — intent is decided by
// positive evidence, not a banned-words list.
const STOP = new Set([
  "the", "a", "an", "how", "do", "does", "did", "is", "are", "was", "what",
  "why", "when", "where", "who", "work", "works", "of", "to", "for", "in",
  "on", "and", "or", "with", "my", "our", "we", "get", "got", "set", "this",
  "that", "it", "its", "i", "you", "can", "should", "would", "about", "into",
  "from", "use", "used", "using", "make", "made", "up",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** path -> set of brief-map keyword tokens routing to it. */
function invertBriefMap(briefMap: Record<string, string>): Map<string, Set<string>> {
  const inv = new Map<string, Set<string>>();
  for (const [key, val] of Object.entries(briefMap)) {
    const p = val.replace(/^\.\//, "");
    if (!inv.has(p)) inv.set(p, new Set());
    for (const t of tokenize(key)) inv.get(p)!.add(t);
  }
  return inv;
}

/** Domain terms tied to a specific brief: its map keywords + title + slug tokens. */
function domainTerms(
  hitPath: string,
  hitTitle: string,
  inv: Map<string, Set<string>>
): Set<string> {
  const terms = new Set(inv.get(hitPath) ?? []);
  const slug = hitPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  for (const t of [...tokenize(hitTitle), ...tokenize(slug)]) {
    if (t !== "brief") terms.add(t);
  }
  return terms;
}

/** Does the query share at least one domain term with the candidate brief? */
export function hasDomainTrigger(
  query: string,
  hitPath: string,
  hitTitle: string,
  briefMap: Record<string, string>
): boolean {
  const terms = domainTerms(hitPath, hitTitle, invertBriefMap(briefMap));
  return tokenize(query).some((t) => terms.has(t));
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

  // 3. Fuzzy tag_search — needs floor AND margin AND a domain trigger. The
  // trigger is the key guard: route only if the query carries evidence tied to
  // THIS brief (a map keyword / title / slug token), so "support phone number"
  // never lands on the security brief just because it's nearby in vector/keyword
  // space. Intent over proximity.
  const second = hits[1]?.score ?? 0;
  const ratio = second > 0 ? top.score / second : Infinity;
  if (
    top.score >= floor &&
    ratio >= marginRatio &&
    hasDomainTrigger(t, top.path, top.title, briefMap)
  ) {
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
