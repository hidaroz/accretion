import { describe, it, expect, beforeEach } from "vitest";
import { SearchIndex } from "../vault/search-index.js";
import type { NoteContent } from "../vault/vault-manager.js";

function makeNote(overrides: Partial<NoteContent> = {}): NoteContent {
  return {
    path: overrides.path ?? "test/note.md",
    title: overrides.title ?? "Test Note",
    tags: overrides.tags ?? [],
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
  });
});
