// Pure scoring helpers for the memory-quality eval harness. No I/O — the
// runner (scripts/memory-eval.mjs) does retrieval and feeds results in here.

export interface PrecisionRecall {
  precision: number;
  recall: number;
  hits: number;
}

/** Per-retrieval-mode score for one case. */
export interface RetrievalScore extends PrecisionRecall {
  /** Did ≥1 expected note land in top-k? (what matters for context assembly) */
  success: boolean;
  /** Reciprocal rank of the first hit within top-k (0 if none) → MRR. */
  rr: number;
}

export interface ModeAggregate {
  recall: number;
  success: number;
  mrr: number;
  precision: number;
}

export interface CaseScore {
  id: string;
  negative: boolean;
  keyword: RetrievalScore;
  semantic: RetrievalScore;
  hybrid: RetrievalScore;
  routingHit: boolean;
}

export interface Aggregate {
  count: number;
  positives: number;
  negatives: number;
  keyword: ModeAggregate;
  semantic: ModeAggregate;
  hybrid: ModeAggregate;
  routingAccuracy: number;
  negativeRoutingAccuracy: number;
}

function norm(p: string): string {
  return p.replace(/^\.\//, "");
}

/** Precision/recall of the top-k retrieved paths against expected paths. */
export function precisionRecallAtK(
  retrieved: string[],
  expected: string[],
  k: number
): PrecisionRecall {
  const topK = retrieved.slice(0, k).map(norm);
  const expectedSet = new Set(expected.map(norm));
  if (topK.length === 0 || expectedSet.size === 0) {
    return { precision: 0, recall: 0, hits: 0 };
  }
  const hits = topK.filter((p) => expectedSet.has(p)).length;
  return {
    precision: hits / topK.length,
    recall: hits / expectedSet.size,
    hits,
  };
}

/** Did at least one expected note appear in the top-k? */
export function successAtK(
  retrieved: string[],
  expected: string[],
  k: number
): boolean {
  const expectedSet = new Set(expected.map(norm));
  return retrieved.slice(0, k).some((p) => expectedSet.has(norm(p)));
}

/** Reciprocal rank of the first expected hit (0 if none). Drives MRR. */
export function reciprocalRank(retrieved: string[], expected: string[]): number {
  const expectedSet = new Set(expected.map(norm));
  for (let i = 0; i < retrieved.length; i++) {
    if (expectedSet.has(norm(retrieved[i]))) return 1 / (i + 1);
  }
  return 0;
}

/** Full per-mode score: precision/recall/hits + success@k + reciprocal rank@k. */
export function scoreRetrieval(
  retrieved: string[],
  expected: string[],
  k: number
): RetrievalScore {
  const pr = precisionRecallAtK(retrieved, expected, k);
  return {
    ...pr,
    success: successAtK(retrieved, expected, k),
    rr: reciprocalRank(retrieved.slice(0, k), expected),
  };
}

/** Did brief routing resolve to the expected brief? expected=null means "no brief expected". */
export function routingHit(
  resolved: string | null,
  expected: string | null
): boolean {
  if (expected === null) return resolved === null;
  return resolved !== null && norm(resolved) === norm(expected);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function aggregate(scores: CaseScore[]): Aggregate {
  const pos = scores.filter((s) => !s.negative);
  const neg = scores.filter((s) => s.negative);
  const modeAgg = (sel: (s: CaseScore) => RetrievalScore): ModeAggregate => ({
    recall: mean(pos.map((s) => sel(s).recall)),
    success: mean(pos.map((s) => (sel(s).success ? 1 : 0))),
    mrr: mean(pos.map((s) => sel(s).rr)),
    precision: mean(pos.map((s) => sel(s).precision)),
  });
  return {
    count: scores.length,
    positives: pos.length,
    negatives: neg.length,
    keyword: modeAgg((s) => s.keyword),
    semantic: modeAgg((s) => s.semantic),
    hybrid: modeAgg((s) => s.hybrid),
    routingAccuracy: mean(pos.map((s) => (s.routingHit ? 1 : 0))),
    // For negatives, routingHit is true iff routing correctly returned null.
    negativeRoutingAccuracy: neg.length
      ? mean(neg.map((s) => (s.routingHit ? 1 : 0)))
      : 1,
  };
}
