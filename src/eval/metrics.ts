// Pure scoring helpers for the memory-quality eval harness. No I/O — the
// runner (scripts/memory-eval.mjs) does retrieval and feeds results in here.

export interface PrecisionRecall {
  precision: number;
  recall: number;
  hits: number;
}

export interface CaseScore {
  id: string;
  keyword: PrecisionRecall;
  semantic: PrecisionRecall;
  routingHit: boolean;
}

export interface Aggregate {
  count: number;
  keywordPrecision: number;
  keywordRecall: number;
  semanticPrecision: number;
  semanticRecall: number;
  routingAccuracy: number;
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
  return {
    count: scores.length,
    keywordPrecision: mean(scores.map((s) => s.keyword.precision)),
    keywordRecall: mean(scores.map((s) => s.keyword.recall)),
    semanticPrecision: mean(scores.map((s) => s.semantic.precision)),
    semanticRecall: mean(scores.map((s) => s.semantic.recall)),
    routingAccuracy: mean(scores.map((s) => (s.routingHit ? 1 : 0))),
  };
}
