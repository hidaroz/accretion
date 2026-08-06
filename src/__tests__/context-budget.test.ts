import { describe, expect, it } from "vitest";
import { truncateAtSection } from "../tools/get-context.js";

/**
 * get_context concatenates whole briefs under a shared token budget, in the
 * order the caller listed topics. That let one oversized brief starve the rest:
 * asking for observability + cycling + structure returned only the Observability brief and a
 * "budget reached" marker, because that brief alone exceeded the default 8k
 * allowance. Each brief now gets a share of the budget and is cut to fit.
 *
 * Cutting mid-sentence would be worse than useless in an assembled context, so
 * the cut prefers a section boundary.
 */
describe("truncateAtSection", () => {
  it("returns the text unchanged when it already fits", () => {
    expect(truncateAtSection("short", 100)).toBe("short");
  });

  it("returns empty for a non-positive limit", () => {
    expect(truncateAtSection("anything", 0)).toBe("");
    expect(truncateAtSection("anything", -5)).toBe("");
  });

  it("cuts at a section heading rather than mid-sentence", () => {
    const text = `${"a".repeat(60)}\n## Second\n${"b".repeat(60)}`;
    const out = truncateAtSection(text, 80);
    expect(out).toBe("a".repeat(60));
    expect(out).not.toContain("## Second");
  });

  it("falls back to a paragraph break when no heading is available", () => {
    const text = `${"a".repeat(60)}\n\n${"b".repeat(60)}`;
    expect(truncateAtSection(text, 80)).toBe("a".repeat(60));
  });

  it("hard-cuts text with no boundaries at all rather than overflowing", () => {
    const out = truncateAtSection("x".repeat(500), 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  /**
   * A brief whose first heading sits late would otherwise collapse to almost
   * nothing — worse than a clean hard cut at the limit.
   */
  it("ignores a boundary in the first half and hard-cuts instead", () => {
    const text = `${"a".repeat(5)}\n## Late\n${"b".repeat(500)}`;
    const out = truncateAtSection(text, 200);
    expect(out.length).toBeGreaterThan(100);
  });

  it("never returns more than the limit", () => {
    const text = Array.from({ length: 40 }, (_, i) => `## S${i}\n${"c".repeat(50)}`).join("\n");
    for (const limit of [10, 55, 120, 400, 1000]) {
      expect(truncateAtSection(text, limit).length).toBeLessThanOrEqual(limit);
    }
  });
});
