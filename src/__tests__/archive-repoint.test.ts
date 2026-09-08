import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repointDigests } from "../engine/lifecycle/archive.js";

/**
 * Archiving moved session files and left every digest pointing at where they
 * used to be. One run stranded dozens of source links across a vault and nothing
 * reported it — validateStructure checks dangling links in the curated layer
 * only, and deliberately skips sessions/.
 *
 * The damage is not cosmetic: getDigestedSessionPaths reads `sources` to decide
 * what is safe to archive, so a digest that has lost track of its own sources
 * stops protecting them.
 */
describe("repointDigests", () => {
  let vault: string;
  let digests: string;

  beforeEach(() => {
    vault = mkdtempSync(path.join(tmpdir(), "vault-"));
    digests = path.join(vault, "sessions", "digests");
    mkdirSync(digests, { recursive: true });
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  const digest = (name: string, body: string) => {
    writeFileSync(path.join(digests, name), body, "utf8");
    return path.join(digests, name);
  };
  const read = (name: string) => readFileSync(path.join(digests, name), "utf8");

  it("rewrites both sources frontmatter and Source Sessions wikilinks", async () => {
    digest(
      "2026-W21-atlas-web-app.md",
      [
        "---",
        "sources:",
        "  - sessions/2026/05-20/atlas-web-app-bbc873c4.md",
        "---",
        "",
        "## Source Sessions",
        "",
        "- [[sessions/2026/05-20/atlas-web-app-bbc873c4.md|Some work]] (2026-05-20)",
        "",
      ].join("\n")
    );

    const changed = await repointDigests(
      vault,
      new Map([
        [
          "sessions/2026/05-20/atlas-web-app-bbc873c4.md",
          "sessions/archive/2026/05-20/atlas-web-app-bbc873c4.md",
        ],
      ])
    );

    expect(changed).toBe(1);
    const out = read("2026-W21-atlas-web-app.md");
    expect(out).toContain("  - sessions/archive/2026/05-20/atlas-web-app-bbc873c4.md");
    expect(out).toContain("[[sessions/archive/2026/05-20/atlas-web-app-bbc873c4.md|Some work]]");
    expect(out).not.toMatch(/- sessions\/2026\//);
  });

  it("leaves digests that reference nothing archived untouched", async () => {
    const before = "---\nsources:\n  - sessions/2026/07-24/atlas-d1c57dd1.md\n---\n";
    digest("2026-W30-atlas.md", before);

    const changed = await repointDigests(
      vault,
      new Map([["sessions/2026/05-20/other.md", "sessions/archive/2026/05-20/other.md"]])
    );

    expect(changed).toBe(0);
    expect(read("2026-W30-atlas.md")).toBe(before);
  });

  it("is idempotent — a second archive run must not double-prefix", async () => {
    digest("d.md", "sources:\n  - sessions/2026/05-20/x.md\n");
    const renames = new Map([
      ["sessions/2026/05-20/x.md", "sessions/archive/2026/05-20/x.md"],
    ]);

    await repointDigests(vault, renames);
    await repointDigests(vault, renames);

    expect(read("d.md")).toContain("sessions/archive/2026/05-20/x.md");
    expect(read("d.md")).not.toContain("sessions/archive/sessions/archive");
    expect(read("d.md")).not.toContain("archive/2026/05-20/archive");
  });

  it("applies every rename in one pass across several digests", async () => {
    digest("a.md", "sources:\n  - sessions/2026/05-20/a.md\n");
    digest("b.md", "sources:\n  - sessions/2026/05-21/b.md\n");

    const changed = await repointDigests(
      vault,
      new Map([
        ["sessions/2026/05-20/a.md", "sessions/archive/2026/05-20/a.md"],
        ["sessions/2026/05-21/b.md", "sessions/archive/2026/05-21/b.md"],
      ])
    );

    expect(changed).toBe(2);
    expect(read("a.md")).toContain("sessions/archive/2026/05-20/a.md");
    expect(read("b.md")).toContain("sessions/archive/2026/05-21/b.md");
  });

  it("is a no-op when nothing was archived", async () => {
    expect(await repointDigests(vault, new Map())).toBe(0);
  });

  it("does not throw when the vault has no digests directory", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "vault-"));
    try {
      expect(
        await repointDigests(empty, new Map([["sessions/a.md", "sessions/archive/a.md"]]))
      ).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
