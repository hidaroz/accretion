import { describe, it, expect } from "vitest";
import { routeBrief } from "../vault/brief-routing.js";

// Fake search index returning controlled type/brief hits.
function idx(hits: Array<{ path: string; title: string; score: number }>) {
  return { search: (_q: string, _o?: { tag?: string; limit?: number }) => hits };
}
const MAP = { auth: "03/brief-auth.md", roasting: "05/brief-coffee.md" };
const OPTS = { floor: 5, marginRatio: 1.5 };

describe("routeBrief", () => {
  it("routes via direct_map without any threshold", () => {
    const r = routeBrief(MAP, idx([]), "auth", OPTS);
    expect(r).toMatchObject({ path: "03/brief-auth.md", method: "direct_map" });
  });

  it("routes on an exact title match even with a thin margin", () => {
    const r = routeBrief({}, idx([
      { path: "x/Cycling.md", title: "Cycling", score: 6 },
      { path: "y/other.md", title: "Other", score: 5.9 },
    ]), "cycling", OPTS);
    expect(r.method).toBe("exact_title");
    expect(r.path).toBe("x/Cycling.md");
  });

  it("routes a strong, well-separated fuzzy hit", () => {
    const r = routeBrief({}, idx([
      { path: "a/brief.md", title: "Some Brief", score: 20 },
      { path: "b/other.md", title: "Other", score: 8 },
    ]), "some query", OPTS);
    expect(r.method).toBe("tag_search");
    expect(r.path).toBe("a/brief.md");
  });

  it("abstains when the top score is below the floor", () => {
    const r = routeBrief({}, idx([{ path: "a/brief.md", title: "X", score: 3 }]), "weak", OPTS);
    expect(r.path).toBeNull();
    expect(r.method).toBe("abstain");
  });

  it("abstains when the margin over #2 is too thin (ambiguous)", () => {
    const r = routeBrief({}, idx([
      { path: "a/brief.md", title: "X", score: 10 },
      { path: "b/brief.md", title: "Y", score: 9 },
    ]), "ambiguous", OPTS);
    expect(r.path).toBeNull();
    expect(r.method).toBe("abstain");
  });

  it("abstains when there are no brief hits (off-domain)", () => {
    const r = routeBrief({}, idx([]), "what is the weather", OPTS);
    expect(r.path).toBeNull();
    expect(r.method).toBe("abstain");
  });

  it("routes a single strong hit with no #2 (infinite margin) when the query shares a domain term", () => {
    const r = routeBrief({}, idx([{ path: "a/widgets.md", title: "Widget Notes", score: 30 }]), "widget", OPTS);
    expect(r.path).toBe("a/widgets.md");
    expect(r.method).toBe("tag_search");
  });

  it("abstains on a strong fuzzy hit with NO domain trigger (intent mismatch)", () => {
    // High score + huge margin, but the query shares no term with the brief —
    // e.g. 'support phone number' should NOT land on the security brief.
    const r = routeBrief(
      { security: "07/brief-security.md" },
      idx([
        { path: "07/brief-security.md", title: "Brief: Security Model", score: 40 },
        { path: "z/other.md", title: "Other", score: 2 },
      ]),
      "support phone number",
      OPTS
    );
    expect(r.path).toBeNull();
    expect(r.method).toBe("abstain");
  });

  it("routes a fuzzy hit when the query DOES carry a domain term", () => {
    const r = routeBrief(
      { security: "07/brief-security.md" },
      idx([
        { path: "07/brief-security.md", title: "Brief: Security Model", score: 40 },
        { path: "z/other.md", title: "Other", score: 2 },
      ]),
      "security authorization model",
      OPTS
    );
    expect(r.path).toBe("07/brief-security.md");
    expect(r.method).toBe("tag_search");
  });
});
