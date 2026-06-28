import { describe, it, expect } from "vitest";
import {
  precisionRecallAtK,
  successAtK,
  reciprocalRank,
  scoreRetrieval,
  routingHit,
  mean,
  bootstrapCI,
  aggregate,
  type CaseScore,
  type RetrievalScore,
} from "../eval/metrics.js";

describe("precisionRecallAtK", () => {
  it("scores a full hit", () => {
    const r = precisionRecallAtK(["a.md", "b.md"], ["a.md", "b.md"], 5);
    expect(r.recall).toBeCloseTo(1);
    expect(r.hits).toBe(2);
  });
  it("truncates to k before scoring", () => {
    const r = precisionRecallAtK(["x.md", "y.md", "a.md"], ["a.md"], 2);
    expect(r.recall).toBe(0);
  });
  it("normalizes leading ./ and handles empties", () => {
    expect(precisionRecallAtK(["./a.md"], ["a.md"], 5).hits).toBe(1);
    expect(precisionRecallAtK([], ["a.md"], 5)).toEqual({ precision: 0, recall: 0, hits: 0 });
  });
});

describe("successAtK", () => {
  it("is true when any expected note is in top-k", () => {
    expect(successAtK(["x.md", "a.md"], ["a.md"], 5)).toBe(true);
  });
  it("respects the k cutoff", () => {
    expect(successAtK(["x.md", "y.md", "a.md"], ["a.md"], 2)).toBe(false);
  });
  it("is false when nothing matches", () => {
    expect(successAtK(["x.md"], ["a.md"], 5)).toBe(false);
  });
});

describe("reciprocalRank", () => {
  it("is 1 when the first result is a hit", () => {
    expect(reciprocalRank(["a.md", "b.md"], ["a.md"])).toBeCloseTo(1);
  });
  it("is 1/2 when the second is the first hit", () => {
    expect(reciprocalRank(["x.md", "a.md"], ["a.md"])).toBeCloseTo(0.5);
  });
  it("is 0 when no hit", () => {
    expect(reciprocalRank(["x.md"], ["a.md"])).toBe(0);
  });
});

describe("scoreRetrieval", () => {
  it("combines pr + success + rr, capping rr at k", () => {
    const s = scoreRetrieval(["x.md", "y.md", "a.md"], ["a.md"], 2);
    expect(s.success).toBe(false); // a.md is rank 3, k=2
    expect(s.rr).toBe(0); // not within top-2
    const s2 = scoreRetrieval(["a.md", "y.md"], ["a.md"], 2);
    expect(s2.success).toBe(true);
    expect(s2.rr).toBeCloseTo(1);
  });
});

describe("routingHit", () => {
  it("matches, misses, and handles expected:null", () => {
    expect(routingHit("a.md", "a.md")).toBe(true);
    expect(routingHit("b.md", "a.md")).toBe(false);
    expect(routingHit(null, null)).toBe(true); // negative case: correctly no brief
    expect(routingHit("x.md", null)).toBe(false); // false-positive routing
  });
});

describe("mean", () => {
  it("averages and is 0 for empty", () => {
    expect(mean([1, 0, 0.5])).toBeCloseTo(0.5);
    expect(mean([])).toBe(0);
  });
});

describe("bootstrapCI", () => {
  it("is deterministic for a fixed seed", () => {
    const v = [1, 0, 1, 0, 1, 1, 0, 1];
    expect(bootstrapCI(v, 500, 7)).toEqual(bootstrapCI(v, 500, 7));
  });
  it("brackets the sample mean", () => {
    const v = [0.5, 0.6, 0.7, 0.8, 0.9];
    const [lo, hi] = bootstrapCI(v, 1000, 42);
    const m = mean(v);
    expect(lo).toBeLessThanOrEqual(m);
    expect(hi).toBeGreaterThanOrEqual(m);
  });
  it("collapses to the value for a constant sample", () => {
    expect(bootstrapCI([0.5, 0.5, 0.5], 200, 1)).toEqual([0.5, 0.5]);
  });
  it("returns [0,0] for empty", () => {
    expect(bootstrapCI([], 100, 1)).toEqual([0, 0]);
  });
});

describe("aggregate", () => {
  const rs = (recall: number, success: boolean, rr: number): RetrievalScore => ({
    precision: recall,
    recall,
    hits: success ? 1 : 0,
    success,
    rr,
  });

  it("rolls up per-mode metrics over positive cases and routing over both", () => {
    // query-pin is the live-faithful headline; topic-pin is the diagnostic that
    // gets the clean keyword. Here topic-pin recovers case 1 that raw/query-pin miss.
    const scores: CaseScore[] = [
      { id: "1", negative: false, keyword: rs(1, true, 1), semantic: rs(0, false, 0), hybridRaw: rs(0, false, 0), hybridQueryPin: rs(0, false, 0), hybridTopicPin: rs(1, true, 1), routingHit: true },
      { id: "2", negative: false, keyword: rs(0, false, 0), semantic: rs(1, true, 0.5), hybridRaw: rs(1, true, 1), hybridQueryPin: rs(1, true, 1), hybridTopicPin: rs(1, true, 1), routingHit: true },
      { id: "neg", negative: true, keyword: rs(0, false, 0), semantic: rs(0, false, 0), hybridRaw: rs(0, false, 0), hybridQueryPin: rs(0, false, 0), hybridTopicPin: rs(0, false, 0), routingHit: true },
    ];
    const agg = aggregate(scores);
    expect(agg.count).toBe(3);
    expect(agg.positives).toBe(2);
    expect(agg.negatives).toBe(1);
    // The parity delta is visible: topic-pin > query-pin because the harness
    // hands topic-pin a clean keyword the live tool never gets.
    expect(agg.hybridTopicPin.recall).toBeCloseTo(1);
    expect(agg.hybridTopicPin.success).toBeCloseTo(1);
    expect(agg.hybridQueryPin.recall).toBeCloseTo(0.5);
    expect(agg.hybridQueryPin.success).toBeCloseTo(0.5);
    expect(agg.hybridRaw.recall).toBeCloseTo(0.5);
    expect(agg.keyword.recall).toBeCloseTo(0.5);
    expect(agg.semantic.recall).toBeCloseTo(0.5);
    expect(agg.hybridTopicPin.mrr).toBeCloseTo(1);
    expect(agg.hybridQueryPin.mrr).toBeCloseTo(0.5); // (0 + 1)/2
    expect(agg.semantic.mrr).toBeCloseTo(0.25); // (0 + 0.5)/2
    expect(agg.routingAccuracy).toBeCloseTo(1); // over positives
    expect(agg.negativeRoutingAccuracy).toBeCloseTo(1); // the negative correctly returned null
  });
});
