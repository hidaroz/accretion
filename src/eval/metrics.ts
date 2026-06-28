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
  /** RRF fusion with no routed-brief pin — pure retrieval. */
  hybridRaw: RetrievalScore;
  /** RRF pinned on the brief routed from the raw query — matches live hybrid_search. Headline. */
  hybridQueryPin: RetrievalScore;
  /** RRF pinned on the brief routed from the clean topic keyword — diagnostic only. */
  hybridTopicPin: RetrievalScore;
  routingHit: boolean;
}

export interface Aggregate {
  count: number;
  positives: number;
  negatives: number;
  keyword: ModeAggregate;
  semantic: ModeAggregate;
  hybridRaw: ModeAggregate;
  hybridQueryPin: ModeAggregate;
  hybridTopicPin: ModeAggregate;
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

/**
 * 95% bootstrap confidence interval for the mean of `values`. Uses a seeded
 * LCG so results are deterministic/reproducible (eval scorecards must not drift
 * run-to-run). Keeps small-sample claims honest.
 */
export function bootstrapCI(
  values: number[],
  iters = 1000,
  seed = 42
): [number, number] {
  if (values.length === 0) return [0, 0];
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const means: number[] = [];
  for (let it = 0; it < iters; it++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[Math.floor(rand() * values.length)];
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
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
    hybridRaw: modeAgg((s) => s.hybridRaw),
    hybridQueryPin: modeAgg((s) => s.hybridQueryPin),
    hybridTopicPin: modeAgg((s) => s.hybridTopicPin),
    routingAccuracy: mean(pos.map((s) => (s.routingHit ? 1 : 0))),
    // For negatives, routingHit is true iff routing correctly returned null.
    negativeRoutingAccuracy: neg.length
      ? mean(neg.map((s) => (s.routingHit ? 1 : 0)))
      : 1,
  };
}
