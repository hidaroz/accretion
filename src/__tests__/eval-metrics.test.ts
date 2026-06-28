import { describe, it, expect } from "vitest";
import {
  precisionRecallAtK,
  routingHit,
  mean,
  aggregate,
  type CaseScore,
} from "../eval/metrics.js";

describe("precisionRecallAtK", () => {
  it("scores a full hit", () => {
    const r = precisionRecallAtK(["a.md", "b.md"], ["a.md", "b.md"], 5);
    expect(r.precision).toBeCloseTo(1);
    expect(r.recall).toBeCloseTo(1);
    expect(r.hits).toBe(2);
  });

  it("scores a partial hit (precision vs recall differ)", () => {
    // retrieved 4, 1 relevant of 2 expected
    const r = precisionRecallAtK(["x.md", "a.md", "y.md", "z.md"], ["a.md", "b.md"], 5);
    expect(r.hits).toBe(1);
    expect(r.precision).toBeCloseTo(1 / 4);
    expect(r.recall).toBeCloseTo(1 / 2);
  });

  it("truncates to k before scoring", () => {
    // a.md is relevant but ranked 3rd; k=2 excludes it
    const r = precisionRecallAtK(["x.md", "y.md", "a.md"], ["a.md"], 2);
    expect(r.hits).toBe(0);
    expect(r.recall).toBe(0);
  });

  it("normalizes a leading ./ on both sides", () => {
    const r = precisionRecallAtK(["./a.md"], ["a.md"], 5);
    expect(r.hits).toBe(1);
  });

  it("handles empty inputs without NaN", () => {
    expect(precisionRecallAtK([], ["a.md"], 5)).toEqual({ precision: 0, recall: 0, hits: 0 });
    expect(precisionRecallAtK(["a.md"], [], 5)).toEqual({ precision: 0, recall: 0, hits: 0 });
  });
});

describe("routingHit", () => {
  it("matches the expected brief", () => {
    expect(routingHit("03/brief-auth.md", "03/brief-auth.md")).toBe(true);
  });
  it("misses a wrong brief", () => {
    expect(routingHit("03/brief-x.md", "03/brief-auth.md")).toBe(false);
  });
  it("treats expected:null as 'no brief expected'", () => {
    expect(routingHit(null, null)).toBe(true);
    expect(routingHit("03/brief-x.md", null)).toBe(false);
  });
  it("normalizes leading ./", () => {
    expect(routingHit("./a.md", "a.md")).toBe(true);
  });
});

describe("mean", () => {
  it("averages and is 0 for empty", () => {
    expect(mean([1, 0, 0.5])).toBeCloseTo(0.5);
    expect(mean([])).toBe(0);
  });
});

describe("aggregate", () => {
  it("rolls up per-case scores into means", () => {
    const cases: CaseScore[] = [
      { id: "1", keyword: { precision: 1, recall: 1, hits: 1 }, semantic: { precision: 0.5, recall: 1, hits: 1 }, routingHit: true },
      { id: "2", keyword: { precision: 0, recall: 0, hits: 0 }, semantic: { precision: 1, recall: 1, hits: 1 }, routingHit: false },
    ];
    const agg = aggregate(cases);
    expect(agg.count).toBe(2);
    expect(agg.keywordPrecision).toBeCloseTo(0.5);
    expect(agg.keywordRecall).toBeCloseTo(0.5);
    expect(agg.semanticPrecision).toBeCloseTo(0.75);
    expect(agg.routingAccuracy).toBeCloseTo(0.5);
  });
});
