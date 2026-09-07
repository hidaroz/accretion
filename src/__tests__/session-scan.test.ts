import { describe, it, expect } from "vitest";
import {
  stripCodeBlocks,
  extractSection,
  parseCreated,
  getISOWeek,
  getYearMonth,
  groupSessions,
  extractProjectTag,
  type SessionNote,
} from "../engine/lifecycle/session-scan.js";

function makeSession(overrides: Partial<SessionNote> = {}): SessionNote {
  return {
    relativePath: overrides.relativePath ?? "sessions/2026/06-01/test.md",
    title: overrides.title ?? "Test Session",
    tags: overrides.tags ?? ["type/session"],
    createdAt: overrides.createdAt ?? new Date("2026-06-01T10:00:00Z"),
    malformedDate: overrides.malformedDate ?? false,
    topics: overrides.topics ?? [],
    filesChanged: overrides.filesChanged ?? [],
    decisions: overrides.decisions ?? [],
    project: overrides.project ?? "atlas-web-app",
  };
}

describe("stripCodeBlocks", () => {
  it("blanks content inside fenced code blocks", () => {
    const content = "before\n```\n## Topics\nsecret\n```\nafter";
    const stripped = stripCodeBlocks(content);
    expect(stripped).not.toContain("## Topics");
    expect(stripped).not.toContain("secret");
    expect(stripped).toContain("before");
    expect(stripped).toContain("after");
  });

  it("preserves line count", () => {
    const content = "a\n```\nb\nc\n```\nd";
    expect(stripCodeBlocks(content).split("\n")).toHaveLength(6);
  });

  it("handles tilde fences", () => {
    const content = "~~~\n## Decisions\n~~~\nvisible";
    const stripped = stripCodeBlocks(content);
    expect(stripped).not.toContain("## Decisions");
    expect(stripped).toContain("visible");
  });

  it("leaves an unclosed fence blanked to end of document", () => {
    const content = "open\n```\n## Topics\n- hidden";
    const stripped = stripCodeBlocks(content);
    expect(stripped).not.toContain("hidden");
  });
});

describe("extractSection", () => {
  it("extracts bullet items under a heading", () => {
    const content = "## Topics\n\n- first topic\n- second topic\n\n## Other\n\n- nope";
    expect(extractSection(content, "Topics")).toEqual([
      "first topic",
      "second topic",
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const content =
      "```md\n## Topics\n- fake topic from a code sample\n```\n\n## Topics\n\n- real topic";
    expect(extractSection(content, "Topics")).toEqual(["real topic"]);
  });

  it("returns empty when the heading only appears in a code block", () => {
    const content = "intro\n\n```\n## Decisions\n- fake\n```\n";
    expect(extractSection(content, "Decisions")).toEqual([]);
  });

  it("escapes regex special characters in the heading", () => {
    const content = "## C++ Notes (v2)\n\n- item one";
    expect(extractSection(content, "C++ Notes (v2)")).toEqual(["item one"]);
  });

  it("stops at the next section heading", () => {
    const content = "## Topics\n\n- a\n\n## Files Changed\n\n- b.ts";
    expect(extractSection(content, "Topics")).toEqual(["a"]);
    expect(extractSection(content, "Files Changed")).toEqual(["b.ts"]);
  });
});

describe("parseCreated", () => {
  const mtime = new Date("2026-05-15T00:00:00Z");

  it("parses a valid ISO string", () => {
    const result = parseCreated({ created: "2026-06-01T10:00:00Z" }, mtime);
    expect(result.malformed).toBe(false);
    expect(result.date.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("falls back to mtime and flags malformed strings", () => {
    const result = parseCreated({ created: "not-a-date" }, mtime);
    expect(result.malformed).toBe(true);
    expect(result.date).toBe(mtime);
  });

  it("accepts a Date instance (gray-matter YAML dates)", () => {
    const d = new Date("2026-06-02T00:00:00Z");
    const result = parseCreated({ created: d }, mtime);
    expect(result.malformed).toBe(false);
    expect(result.date).toBe(d);
  });

  it("falls back to mtime without flagging when created is missing", () => {
    const result = parseCreated({}, mtime);
    expect(result.malformed).toBe(false);
    expect(result.date).toBe(mtime);
  });
});

describe("getISOWeek", () => {
  it("computes a mid-year week", () => {
    expect(getISOWeek(new Date("2026-06-10T00:00:00Z"))).toBe("2026-W24");
  });

  it("assigns end-of-December days to the next ISO year when applicable", () => {
    // 2025-12-29 is a Monday; its Thursday is 2026-01-01
    expect(getISOWeek(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("getYearMonth", () => {
  it("formats year-month with zero padding", () => {
    expect(getYearMonth(new Date("2026-06-10T00:00:00Z"))).toBe("2026-06");
  });
});

describe("extractProjectTag", () => {
  it("extracts the project slug", () => {
    expect(extractProjectTag(["type/session", "project/atlas-infra"])).toBe(
      "atlas-infra"
    );
  });

  it("returns 'unknown' when no project tag exists", () => {
    expect(extractProjectTag(["type/session"])).toBe("unknown");
  });
});

describe("groupSessions", () => {
  it("groups by project and ISO week", () => {
    const sessions = [
      makeSession({ project: "a", createdAt: new Date("2026-06-08T10:00:00Z") }),
      makeSession({ project: "a", createdAt: new Date("2026-06-09T10:00:00Z") }),
      makeSession({ project: "b", createdAt: new Date("2026-06-08T10:00:00Z") }),
      makeSession({ project: "a", createdAt: new Date("2026-06-01T10:00:00Z") }),
    ];
    const groups = groupSessions(sessions, "week");
    expect(groups.get("a:2026-W24")).toHaveLength(2);
    expect(groups.get("b:2026-W24")).toHaveLength(1);
    expect(groups.get("a:2026-W23")).toHaveLength(1);
  });

  it("groups by project and month", () => {
    const sessions = [
      makeSession({ project: "a", createdAt: new Date("2026-05-30T10:00:00Z") }),
      makeSession({ project: "a", createdAt: new Date("2026-06-01T10:00:00Z") }),
    ];
    const groups = groupSessions(sessions, "month");
    expect(groups.get("a:2026-05")).toHaveLength(1);
    expect(groups.get("a:2026-06")).toHaveLength(1);
  });
});
