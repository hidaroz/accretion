import { describe, it, expect, beforeEach } from "vitest";
import { TagIndex } from "../engine/vault/tag-index.js";

describe("TagIndex", () => {
  let tagIndex: TagIndex;

  beforeEach(() => {
    tagIndex = new TagIndex();
  });

  describe("addNote", () => {
    it("adds tags for a note", () => {
      tagIndex.addNote("note1.md", ["foo", "bar"]);
      expect(tagIndex.getNotesByTag("foo")).toEqual(["note1.md"]);
      expect(tagIndex.getNotesByTag("bar")).toEqual(["note1.md"]);
    });

    it("handles multiple notes with the same tag", () => {
      tagIndex.addNote("note1.md", ["shared"]);
      tagIndex.addNote("note2.md", ["shared"]);
      const notes = tagIndex.getNotesByTag("shared");
      expect(notes).toHaveLength(2);
      expect(notes).toContain("note1.md");
      expect(notes).toContain("note2.md");
    });

    it("replaces tags on re-add (update)", () => {
      tagIndex.addNote("note1.md", ["old-tag"]);
      tagIndex.addNote("note1.md", ["new-tag"]);

      expect(tagIndex.getNotesByTag("old-tag")).toEqual([]);
      expect(tagIndex.getNotesByTag("new-tag")).toEqual(["note1.md"]);
    });
  });

  describe("removeNote", () => {
    it("removes all tags for a note", () => {
      tagIndex.addNote("note1.md", ["a", "b"]);
      tagIndex.removeNote("note1.md");

      expect(tagIndex.getNotesByTag("a")).toEqual([]);
      expect(tagIndex.getNotesByTag("b")).toEqual([]);
    });

    it("cleans up empty tag entries", () => {
      tagIndex.addNote("note1.md", ["only-here"]);
      tagIndex.removeNote("note1.md");

      const allTags = tagIndex.getAllTags();
      expect(allTags.find((t) => t.tag === "only-here")).toBeUndefined();
    });

    it("no-ops for non-existent notes", () => {
      tagIndex.removeNote("nonexistent.md");
      expect(tagIndex.getAllTags()).toEqual([]);
    });
  });

  describe("getAllTags", () => {
    it("returns all tags sorted by frequency", () => {
      tagIndex.addNote("note1.md", ["common", "rare"]);
      tagIndex.addNote("note2.md", ["common"]);
      tagIndex.addNote("note3.md", ["common", "medium"]);
      tagIndex.addNote("note4.md", ["medium"]);

      const tags = tagIndex.getAllTags();
      expect(tags[0]).toEqual({ tag: "common", count: 3 });
      expect(tags[1]).toEqual({ tag: "medium", count: 2 });
      expect(tags[2]).toEqual({ tag: "rare", count: 1 });
    });

    it("filters by prefix", () => {
      tagIndex.addNote("note1.md", ["type/brief", "type/spec", "other"]);

      const typeTags = tagIndex.getAllTags("type/");
      expect(typeTags).toHaveLength(2);
      expect(typeTags.every((t) => t.tag.startsWith("type/"))).toBe(true);
    });

    it("returns empty array when no tags exist", () => {
      expect(tagIndex.getAllTags()).toEqual([]);
    });
  });

  describe("getNotesByTag", () => {
    it("returns notes for an existing tag", () => {
      tagIndex.addNote("note1.md", ["target"]);
      tagIndex.addNote("note2.md", ["target"]);
      expect(tagIndex.getNotesByTag("target")).toHaveLength(2);
    });

    it("returns empty array for non-existent tag", () => {
      expect(tagIndex.getNotesByTag("nope")).toEqual([]);
    });

    it("performs case-insensitive lookup", () => {
      tagIndex.addNote("note1.md", ["lowercase"]);
      expect(tagIndex.getNotesByTag("LOWERCASE")).toEqual(["note1.md"]);
    });
  });
});
