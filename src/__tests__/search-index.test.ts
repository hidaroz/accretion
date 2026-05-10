import { describe, it, expect, beforeEach } from "vitest";
import { SearchIndex } from "../vault/search-index.js";
import type { NoteContent } from "../vault/vault-manager.js";

function makeNote(overrides: Partial<NoteContent> = {}): NoteContent {
  return {
    path: overrides.path ?? "test/note.md",
    title: overrides.title ?? "Test Note",
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    modifiedAt: overrides.modifiedAt ?? new Date().toISOString(),
    size: overrides.size ?? 100,
    frontmatter: overrides.frontmatter ?? {},
    content: overrides.content ?? "Default content",
  };
}

describe("SearchIndex", () => {
  let index: SearchIndex;

  beforeEach(() => {
    index = new SearchIndex();
  });

  describe("addOrUpdate", () => {
    it("adds a note and makes it searchable", () => {
      index.addOrUpdate(makeNote({ title: "Roasting Guide", content: "How roasting works" }));
      const results = index.search("roasting");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Roasting Guide");
    });

    it("updates an existing note", () => {
      const note = makeNote({ path: "same.md", title: "Old Title" });
      index.addOrUpdate(note);
      index.addOrUpdate(makeNote({ path: "same.md", title: "New Title" }));

      expect(index.size).toBe(1);
      const results = index.search("New Title");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("New Title");
    });
  });

  describe("remove", () => {
    it("removes a note from the index", () => {
      index.addOrUpdate(makeNote({ path: "remove-me.md", title: "Removable" }));
      expect(index.size).toBe(1);

      index.remove("remove-me.md");
      expect(index.size).toBe(0);
    });

    it("no-ops for non-existent paths", () => {
      index.remove("does-not-exist.md");
      expect(index.size).toBe(0);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      index.addOrUpdate(makeNote({
        path: "05-Kitchen/roasting.md",
        title: "Roasting System",
        tags: ["type/brief", "roasting"],
        content: "Sourdough and roasting documentation",
      }));
      index.addOrUpdate(makeNote({
        path: "03-Architecture/auth.md",
        title: "Auth & RBAC",
        tags: ["type/brief", "auth"],
        content: "Authentication and role-based access control",
      }));
      index.addOrUpdate(makeNote({
        path: "notes/random.md",
        title: "Random Note",
        tags: ["misc"],
        content: "Some random content about roasting topics",
      }));
    });

    it("returns results ranked by relevance", () => {
      const results = index.search("roasting");
      expect(results.length).toBeGreaterThan(0);
      // Title match should rank higher than content-only match
      expect(results[0].path).toBe("05-Kitchen/roasting.md");
    });

    it("filters by folder", () => {
      const results = index.search("roasting", { folder: "05-Kitchen" });
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe("05-Kitchen/roasting.md");
    });

    it("filters by tag", () => {
      const results = index.search("roasting", { tag: "type/brief" });
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe("05-Kitchen/roasting.md");
    });

    it("respects limit", () => {
      const results = index.search("roasting", { limit: 1 });
      expect(results).toHaveLength(1);
    });

    it("returns empty array for no matches", () => {
      const results = index.search("xyznonexistent");
      expect(results).toEqual([]);
    });
  });

  describe("snippet generation", () => {
    it("uses TL;DR line if present", () => {
      index.addOrUpdate(makeNote({
        path: "brief.md",
        title: "Brief",
        content: "> TL;DR: This is the summary\n\n## Details\nMore content here.",
      }));
      const results = index.search("Brief");
      expect(results[0].snippet).toBe("This is the summary");
    });

    it("falls back to keyword proximity snippet", () => {
      index.addOrUpdate(makeNote({
        path: "long.md",
        title: "Long Note",
        content: "A".repeat(200) + " roasting details here " + "B".repeat(200),
      }));
      const results = index.search("roasting");
      expect(results[0].snippet).toContain("roasting");
    });

    it("uses Topics section for session notes", () => {
      index.addOrUpdate(makeNote({
        path: "sessions/2026/05-07/test.md",
        title: "Session Note",
        tags: ["type/session"],
        content: "# Session\n\n## Topics\n\n- discussed roasting changes\n- reviewed auth flow\n\n## Files Changed\n\n- src/roasting.ts",
      }));
      const results = index.search("Session Note");
      expect(results[0].snippet).toContain("discussed roasting");
    });
  });

  describe("freshness weighting", () => {
    it("ranks recent notes higher than old notes with same content", () => {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600000);

      index.addOrUpdate(makeNote({
        path: "old.md",
        title: "Deployment Guide",
        content: "How to deploy the application",
        createdAt: ninetyDaysAgo.toISOString(),
      }));
      index.addOrUpdate(makeNote({
        path: "new.md",
        title: "Deployment Guide",
        content: "How to deploy the application",
        createdAt: now.toISOString(),
      }));

      const results = index.search("deployment guide");
      expect(results).toHaveLength(2);
      expect(results[0].path).toBe("new.md");
    });

    it("title boost still dominates freshness for briefs", () => {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600000);

      index.addOrUpdate(makeNote({
        path: "brief.md",
        title: "Roasting System",
        tags: ["type/brief"],
        content: "Complete roasting documentation",
        createdAt: ninetyDaysAgo.toISOString(),
      }));
      index.addOrUpdate(makeNote({
        path: "recent.md",
        title: "Random Note",
        content: "mentioned roasting in passing",
        createdAt: now.toISOString(),
      }));

      const results = index.search("roasting");
      expect(results[0].path).toBe("brief.md");
    });
  });

  describe("session de-prioritization", () => {
    beforeEach(() => {
      index.addOrUpdate(makeNote({
        path: "05-Kitchen/roasting-brief.md",
        title: "Roasting System Brief",
        tags: ["type/brief"],
        content: "Complete roasting and sourdough documentation",
      }));
      index.addOrUpdate(makeNote({
        path: "sessions/2026/05-07/session.md",
        title: "Roasting discussion session",
        tags: ["type/session", "project/work"],
        content: "## Topics\n\n- discussed roasting changes\n\n## Files Changed\n\n- roasting.ts",
      }));
    });

    it("de-prioritizes session notes in default search", () => {
      const results = index.search("roasting");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("05-Kitchen/roasting-brief.md");
    });

    it("does not de-prioritize when explicitly searching sessions", () => {
      const results = index.search("roasting", { tag: "type/session" });
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe("sessions/2026/05-07/session.md");
    });
  });
});
