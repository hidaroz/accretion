import { describe, it, expect } from "vitest";
import {
  parseNote,
  stringifyNote,
  mergeFrontmatter,
  extractTitle,
  extractTags,
} from "../vault/frontmatter.js";

describe("parseNote", () => {
  it("parses frontmatter and content", () => {
    const raw = `---
title: Test Note
tags:
  - foo
  - bar
---

# Hello

Body text here.`;
    const result = parseNote(raw);
    expect(result.frontmatter.title).toBe("Test Note");
    expect(result.frontmatter.tags).toEqual(["foo", "bar"]);
    expect(result.content).toContain("# Hello");
    expect(result.content).toContain("Body text here.");
  });

  it("handles notes without frontmatter", () => {
    const raw = "# Just a heading\n\nSome content.";
    const result = parseNote(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toContain("# Just a heading");
  });

  it("handles empty notes", () => {
    const result = parseNote("");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("");
  });
});

describe("stringifyNote", () => {
  it("adds frontmatter block when fields exist", () => {
    const result = stringifyNote("Hello world", { title: "Test" });
    expect(result).toContain("---");
    expect(result).toContain("title: Test");
    expect(result).toContain("Hello world");
  });

  it("omits frontmatter block when empty", () => {
    const result = stringifyNote("Hello world", {});
    expect(result).toBe("Hello world");
    expect(result).not.toContain("---");
  });

  it("round-trips with parseNote", () => {
    const content = "Some body content.";
    const fm = { title: "Round Trip", tags: ["a", "b"] };
    const raw = stringifyNote(content, fm);
    const parsed = parseNote(raw);
    expect(parsed.frontmatter.title).toBe("Round Trip");
    expect(parsed.frontmatter.tags).toEqual(["a", "b"]);
    expect(parsed.content.trim()).toBe(content);
  });
});

describe("mergeFrontmatter", () => {
  it("merges updates into existing", () => {
    const result = mergeFrontmatter(
      { title: "Old", tags: ["a"] },
      { title: "New", author: "Me" }
    );
    expect(result).toEqual({ title: "New", tags: ["a"], author: "Me" });
  });

  it("preserves existing keys not in updates", () => {
    const result = mergeFrontmatter(
      { title: "Keep", custom: true },
      { author: "New" }
    );
    expect(result).toEqual({ title: "Keep", custom: true, author: "New" });
  });
});

describe("extractTitle", () => {
  it("prefers frontmatter title", () => {
    const title = extractTitle(
      { title: "FM Title" },
      "# H1 Title",
      "notes/file.md"
    );
    expect(title).toBe("FM Title");
  });

  it("trims whitespace from frontmatter title", () => {
    const title = extractTitle({ title: "  Spaced  " }, "", "file.md");
    expect(title).toBe("Spaced");
  });

  it("falls back to first H1 heading", () => {
    const title = extractTitle(
      {},
      "Some preamble\n# My Heading\n\nBody text",
      "file.md"
    );
    expect(title).toBe("My Heading");
  });

  it("falls back to filename without extension", () => {
    const title = extractTitle({}, "No heading here", "notes/my-note.md");
    expect(title).toBe("my-note");
  });

  it("ignores empty frontmatter title", () => {
    const title = extractTitle({ title: "  " }, "# Fallback", "file.md");
    expect(title).toBe("Fallback");
  });

  it("ignores non-string frontmatter title", () => {
    const title = extractTitle({ title: 42 }, "# Fallback", "file.md");
    expect(title).toBe("Fallback");
  });
});

describe("extractTags", () => {
  it("extracts tags from frontmatter array", () => {
    const tags = extractTags({ tags: ["Foo", "Bar"] }, "");
    expect(tags).toEqual(["bar", "foo"]);
  });

  it("extracts tags from frontmatter CSV string", () => {
    const tags = extractTags({ tags: "alpha, beta, gamma" }, "");
    expect(tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("extracts inline #tags from content", () => {
    const tags = extractTags({}, "Some text #project and #status/done here");
    expect(tags).toEqual(["project", "status/done"]);
  });

  it("merges frontmatter and inline tags", () => {
    const tags = extractTags(
      { tags: ["from-fm"] },
      "Content with #inline-tag"
    );
    expect(tags).toEqual(["from-fm", "inline-tag"]);
  });

  it("deduplicates tags (case-insensitive)", () => {
    const tags = extractTags({ tags: ["Foo"] }, "Text #foo here");
    expect(tags).toEqual(["foo"]);
  });

  it("ignores numeric-starting inline tags", () => {
    const tags = extractTags({}, "Text #123 here #valid");
    expect(tags).toEqual(["valid"]);
  });

  it("handles no tags gracefully", () => {
    const tags = extractTags({}, "No tags at all");
    expect(tags).toEqual([]);
  });

  it("returns sorted tags", () => {
    const tags = extractTags({ tags: ["zebra", "alpha", "middle"] }, "");
    expect(tags).toEqual(["alpha", "middle", "zebra"]);
  });
});
