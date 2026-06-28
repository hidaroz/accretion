import { describe, it, expect } from "vitest";
import { rrf, isRawSession, hybridSearch } from "../vault/hybrid.js";

describe("rrf", () => {
  it("ranks an item appearing in both lists above single-list items", () => {
    const out = rrf([
      ["a.md", "b.md", "c.md"],
      ["x.md", "a.md", "y.md"],
    ]);
    // a.md is in both → should be first
    expect(out[0]).toBe("a.md");
    expect(out).toContain("x.md");
    expect(out).toContain("c.md");
  });

  it("recovers complementary hits from either list", () => {
    // keyword finds k1; semantic finds s1; fusion surfaces both near the top
    const out = rrf([["k1.md"], ["s1.md"]]);
    expect(out.slice(0, 2).sort()).toEqual(["k1.md", "s1.md"]);
  });

  it("is deterministic (lexicographic tie-break)", () => {
    const out = rrf([["a.md"], ["b.md"]]); // equal scores
    expect(out).toEqual(["a.md", "b.md"]);
  });

  it("applies a weight to demote paths", () => {
    // same rank in their lists, but b is demoted → a first
    const out = rrf([["a.md"], ["b.md"]], { weight: (p) => (p === "b.md" ? 0.1 : 1) });
    expect(out[0]).toBe("a.md");
  });
});

describe("isRawSession", () => {
  it("flags raw sessions but not digests or briefs", () => {
    expect(isRawSession("sessions/2026/06-01/x.md")).toBe(true);
    expect(isRawSession("sessions/digests/2026-W24-x.md")).toBe(false);
    expect(isRawSession("03-Architecture/brief-auth.md")).toBe(false);
  });
});

describe("hybridSearch", () => {
  const keyword = {
    search: (_q: string, _o?: { limit?: number }) => [
      { path: "03/brief-auth.md" },
      { path: "sessions/2026/s.md" },
    ],
  };
  const semantic = {
    search: async (_q: string, _l?: number) => [
      { path: "sessions/2026/s.md" },
      { path: "03/brief-auth.md" },
    ],
  };

  it("fuses keyword + semantic and demotes raw sessions", async () => {
    const out = await hybridSearch(keyword, semantic, "auth", 5);
    // brief is in both lists AND not demoted → ranks above the raw session
    expect(out[0]).toBe("03/brief-auth.md");
    expect(out).toContain("sessions/2026/s.md");
  });

  it("works with no semantic index (keyword only)", async () => {
    const out = await hybridSearch(keyword, null, "auth", 5);
    expect(out[0]).toBe("03/brief-auth.md");
  });
});
