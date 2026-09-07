import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseWikilinks, buildWikilinkIndex } from "../engine/vault/wikilink-index.js";
import { readAllNotes } from "../engine/vault/note-scan.js";
import { findOrphanNotes } from "../engine/lifecycle/orphan-detection.js";
import { validateStructure } from "../engine/lifecycle/structure-validation.js";
import { findNewDomainCandidates } from "../engine/lifecycle/domain-candidates.js";
import { findResurfaceCandidates } from "../engine/lifecycle/resurface-review.js";

let vaultRoot: string;

async function writeNote(
  relativePath: string,
  frontmatterYaml: string,
  body: string
): Promise<void> {
  const abs = path.join(vaultRoot, relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `---\n${frontmatterYaml}\n---\n\n${body}`);
}

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gardener-test-"));
});

afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

describe("parseWikilinks", () => {
  it("extracts plain, aliased, heading, and embed links; ignores code", () => {
    const content =
      "See [[Note A]] and [[Note B|alias]] and [[Note C#section]] and ![[Embed]].\n" +
      "```\n[[Not A Link]]\n```";
    const links = parseWikilinks(content);
    expect(links).toContain("Note A");
    expect(links).toContain("Note B");
    expect(links).toContain("Note C");
    expect(links).toContain("Embed");
    expect(links).not.toContain("Not A Link");
  });

  it("ignores inline-code links and Next.js catch-all route segments", () => {
    const content =
      "Route at `/studio/[[...tool]]/page.tsx` and a bare path " +
      "app/studio/[[...slug]]/layout.tsx but a real [[Note A]].";
    const links = parseWikilinks(content);
    expect(links).toContain("Note A");
    expect(links).not.toContain("...tool");
    expect(links).not.toContain("...slug");
  });
});

describe("buildWikilinkIndex", () => {
  it("builds forward and backlinks and flags dangling targets", async () => {
    await writeNote("MOCs/Topic.md", "title: Topic\ntags:\n  - type/moc", "Links [[Note A]] and [[Ghost]]");
    await writeNote("Knowledge/Note A.md", "title: Note A\ntags:\n  - type/note", "Body");

    const notes = await readAllNotes(vaultRoot);
    const index = buildWikilinkIndex(notes);

    expect(index.forward.get("MOCs/Topic.md")?.has("Knowledge/Note A.md")).toBe(true);
    expect(index.backlinks.get("Knowledge/Note A.md")?.has("MOCs/Topic.md")).toBe(true);
    expect(index.dangling.get("MOCs/Topic.md")?.has("Ghost")).toBe(true);
  });

  it("resolves a link by the target's frontmatter title when filename differs", async () => {
    // File is slug-named but titled in display style; link uses the title.
    await writeNote("03-Architecture/brief-auth-rbac.md", "title: 'Brief: Auth & RBAC'\ntags:\n  - type/brief", "Body");
    await writeNote("03-Architecture/ADR.md", "title: ADR", "See [[Brief: Auth & RBAC]]");

    const index = buildWikilinkIndex(await readAllNotes(vaultRoot));

    expect(index.forward.get("03-Architecture/ADR.md")?.has("03-Architecture/brief-auth-rbac.md")).toBe(true);
    expect(index.backlinks.get("03-Architecture/brief-auth-rbac.md")?.has("03-Architecture/ADR.md")).toBe(true);
    expect(index.dangling.get("03-Architecture/ADR.md")).toBeUndefined();
  });

  it("resolves a link by a frontmatter alias when title and filename both differ", async () => {
    await writeNote(
      "03-Architecture/Authentication Flow.md",
      "title: Authentication Flow\naliases:\n  - Auth Flow",
      "Body"
    );
    await writeNote("03-Architecture/Source.md", "title: Source", "See [[Auth Flow]]");

    const index = buildWikilinkIndex(await readAllNotes(vaultRoot));

    expect(index.forward.get("03-Architecture/Source.md")?.has("03-Architecture/Authentication Flow.md")).toBe(true);
    expect(index.dangling.get("03-Architecture/Source.md")).toBeUndefined();
  });

  it("supports aliases provided as a comma-separated string", async () => {
    await writeNote("a/Target.md", "title: Target\naliases: First Alias, Second Alias", "Body");
    await writeNote("a/Src.md", "title: Src", "[[Second Alias]]");

    const index = buildWikilinkIndex(await readAllNotes(vaultRoot));

    expect(index.forward.get("a/Src.md")?.has("a/Target.md")).toBe(true);
  });

  it("prefers exact path and basename over title/alias matches", async () => {
    // A note's title collides with another note's basename — basename wins.
    await writeNote("a/Real.md", "title: Decoy", "Body");
    await writeNote("b/Other.md", "title: Real", "Body");
    await writeNote("c/Src.md", "title: Src", "[[Real]]");

    const index = buildWikilinkIndex(await readAllNotes(vaultRoot));

    // [[Real]] must resolve to the file *named* Real.md, not the one titled Real.
    expect(index.forward.get("c/Src.md")?.has("a/Real.md")).toBe(true);
    expect(index.forward.get("c/Src.md")?.has("b/Other.md")).toBe(false);
  });

  it("prefers an alias match over a title match", async () => {
    await writeNote("a/Aliased.md", "title: Something Else\naliases:\n  - Shared Key", "Body");
    await writeNote("b/Titled.md", "title: Shared Key", "Body");
    await writeNote("c/Src.md", "title: Src", "[[Shared Key]]");

    const index = buildWikilinkIndex(await readAllNotes(vaultRoot));

    expect(index.forward.get("c/Src.md")?.has("a/Aliased.md")).toBe(true);
    expect(index.forward.get("c/Src.md")?.has("b/Titled.md")).toBe(false);
  });

  it("resolves title collisions deterministically to the shortest path", async () => {
    await writeNote("zzz/long/path/A.md", "title: Shared Title", "Body");
    await writeNote("B.md", "title: Shared Title", "Body");
    await writeNote("Src.md", "title: Src", "[[Shared Title]]");

    const index = buildWikilinkIndex(await readAllNotes(vaultRoot));

    expect(index.forward.get("Src.md")?.has("B.md")).toBe(true);
  });
});

describe("findOrphanNotes", () => {
  it("flags knowledge notes with no MOC link and fully isolated notes", async () => {
    await writeNote("Home.md", "title: Home\ntags:\n  - type/moc", "[[Topic]]");
    await writeNote("MOCs/Topic.md", "title: Topic\ntags:\n  - type/moc", "[[Linked]]");
    await writeNote("Knowledge/Linked.md", "title: Linked\ntags:\n  - type/note", "Source: [[sess]]");
    // Linked only from another knowledge note, not a MOC:
    await writeNote("Knowledge/NoMoc.md", "title: NoMoc\ntags:\n  - type/note", "Source: [[sess]]");
    await writeNote("Knowledge/Linked2.md", "title: Linked2\ntags:\n  - type/note", "[[NoMoc]] Source: [[sess]]");
    // Wait: Linked2 also needs a MOC link to not be an orphan itself — fine, it'll be flagged too.
    await writeNote("Knowledge/Isolated.md", "title: Isolated\ntags:\n  - type/note", "Nothing links here");

    const { orphans } = await findOrphanNotes(vaultRoot);
    const paths = orphans.map((o) => o.path);

    expect(paths).not.toContain("Knowledge/Linked.md"); // linked from a MOC
    expect(paths).toContain("Knowledge/Isolated.md");
    expect(orphans.find((o) => o.path === "Knowledge/Isolated.md")?.reason).toBe("isolated");
    expect(paths).toContain("Knowledge/NoMoc.md");
    expect(orphans.find((o) => o.path === "Knowledge/NoMoc.md")?.reason).toBe("no-moc");
  });
});

describe("validateStructure", () => {
  it("detects MOCs missing from Home, dangling links, and missing sources", async () => {
    await writeNote("Home.md", "title: Home\ntags:\n  - type/moc", "[[Linked MOC]]");
    await writeNote("MOCs/Linked MOC.md", "title: Linked MOC\ntags:\n  - type/moc", "[[Good Note]]");
    await writeNote("MOCs/Orphan MOC.md", "title: Orphan MOC\ntags:\n  - type/moc", "hub not in home");
    await writeNote("Knowledge/Good Note.md", "title: Good Note\ntags:\n  - type/note", "Source: [[sess]]");
    await writeNote("Knowledge/No Source.md", "title: No Source\ntags:\n  - type/note", "[[Ghost Target]]");

    const { issues } = await validateStructure(vaultRoot);
    const kinds = issues.map((i) => `${i.kind}:${i.path}`);

    expect(kinds).toContain("moc-not-in-home:MOCs/Orphan MOC.md");
    expect(kinds).toContain("missing-source:Knowledge/No Source.md");
    expect(kinds).toContain("dangling-link:Knowledge/No Source.md");
    expect(kinds).not.toContain("moc-not-in-home:MOCs/Linked MOC.md");
  });
});

describe("findNewDomainCandidates", () => {
  it("proposes topic clusters above threshold with no MOC", async () => {
    await writeNote("MOCs/Cyber.md", "title: Cyber\ntags:\n  - type/moc\n  - topic/cyber", "");
    // topic/cyber owned by a MOC -> not a candidate even if many notes.
    for (let i = 0; i < 3; i++)
      await writeNote(`Knowledge/c${i}.md`, "tags:\n  - type/note\n  - topic/cyber", "x");
    // topic/finance has 3 notes, no MOC -> candidate.
    for (let i = 0; i < 3; i++)
      await writeNote(`Knowledge/f${i}.md`, "tags:\n  - type/note\n  - topic/finance", "x");
    // topic/rare has 1 note -> below threshold.
    await writeNote("Knowledge/r0.md", "tags:\n  - type/note\n  - topic/rare", "x");

    const { candidates } = await findNewDomainCandidates(vaultRoot, { threshold: 3 });
    const tags = candidates.map((c) => c.tag);
    expect(tags).toContain("topic/finance");
    expect(tags).not.toContain("topic/cyber");
    expect(tags).not.toContain("topic/rare");
  });
});

describe("findResurfaceCandidates", () => {
  it("returns notes past the review window, most overdue first", async () => {
    const now = new Date("2026-06-21T00:00:00Z");
    await writeNote("Knowledge/Fresh.md", "tags:\n  - type/note\ndate: '2026-06-20'", "x");
    await writeNote("Knowledge/Old.md", "tags:\n  - type/note\ndate: '2026-01-01'", "x");
    await writeNote("Knowledge/Reviewed.md", "tags:\n  - type/note\ndate: '2026-01-01'\nlast_reviewed: '2026-06-19'", "x");

    const { candidates } = await findResurfaceCandidates(vaultRoot, { window: 14, now });
    const paths = candidates.map((c) => c.path);
    expect(paths).toContain("Knowledge/Old.md");
    expect(paths).not.toContain("Knowledge/Fresh.md"); // 1 day old
    expect(paths).not.toContain("Knowledge/Reviewed.md"); // reviewed 2 days ago
    expect(candidates[0].path).toBe("Knowledge/Old.md");
  });
});
