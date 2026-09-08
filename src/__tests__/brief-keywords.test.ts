import { describe, it, expect } from "vitest";
import {
  buildBriefMap,
  keywordsFromFrontmatter,
  isRoutableTagSet,
} from "../engine/retrieval/brief-keywords.js";
import { SearchIndex } from "../engine/retrieval/search-index.js";
import { routeBrief } from "../engine/retrieval/brief-routing.js";
import type { NoteContent } from "../engine/vault/vault-manager.js";

function note(path: string, tags: string[], fm: Record<string, unknown>, content: string): NoteContent {
  return {
    path,
    title: typeof fm.title === "string" ? fm.title : path,
    tags,
    createdAt: "2026-08-01T00:00:00.000Z",
    modifiedAt: "2026-08-01T00:00:00.000Z",
    size: content.length,
    frontmatter: fm,
    content,
  };
}

describe("frontmatter keywords", () => {
  it("reads keywords and aliases, arrays or comma strings, lower-cased", () => {
    expect(keywordsFromFrontmatter({ keywords: ["Roasting", " beans "], aliases: "RRF, fusion" })).toEqual([
      "roasting",
      "beans",
      "rrf",
      "fusion",
    ]);
    expect(keywordsFromFrontmatter({})).toEqual([]);
  });

  it("only routable note types contribute, and the file map wins on conflict", () => {
    expect(isRoutableTagSet(["type/playbook"])).toBe(true);
    expect(isRoutableTagSet(["type/session"])).toBe(false);
    const map = buildBriefMap(
      [
        { path: "01/brief-a.md", tags: ["type/brief"], frontmatter: { keywords: ["auth", "login"] } },
        { path: "02/playbook-b.md", tags: ["type/playbook"], frontmatter: { keywords: ["deploy"] } },
        { path: "03/rejected-c.md", tags: ["type/rejected"], frontmatter: { aliases: ["graphql"] } },
        { path: "sessions/x.md", tags: ["type/session"], frontmatter: { keywords: ["auth"] } },
      ],
      { login: "01/brief-override.md" }
    );
    expect(map).toEqual({
      auth: "01/brief-a.md",
      login: "01/brief-override.md",
      deploy: "02/playbook-b.md",
      graphql: "03/rejected-c.md",
    });
  });
});

describe("routing over frontmatter keywords", () => {
  it("routes a playbook by its declared keyword and by direct map", async () => {
    const idx = new SearchIndex({ now: () => Date.parse("2026-08-01T00:00:00Z") });
    await idx.buildFromVault(null as never, [
      note("02/playbook-deploy.md", ["type/playbook"], { title: "Deploying safely", keywords: ["deploy", "release"] }, "# Deploying safely\n\nSteps for a release."),
      note("01/brief-auth.md", ["type/brief"], { title: "Auth and RBAC", keywords: ["auth"] }, "# Auth\n\nLogin flow."),
      note("sessions/2026/08-01/x.md", ["type/session"], { title: "Session about deploy" }, "# Session\n\n## Topics\n\n- deploy things\n"),
    ]);
    const map = idx.briefMap();
    expect(map).toEqual({ deploy: "02/playbook-deploy.md", release: "02/playbook-deploy.md", auth: "01/brief-auth.md" });

    const direct = routeBrief(map, idx, "release");
    expect(direct).toMatchObject({ path: "02/playbook-deploy.md", method: "direct_map" });

    // Fuzzy path spans playbooks too: title match must be found via the tags filter.
    const byTitle = routeBrief({}, idx, "deploying safely");
    expect(byTitle.path).toBe("02/playbook-deploy.md");
  });
});
