import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applySectionEdits,
  parseEdits,
  findApplicableProposals,
  applyProposal,
  type ProposalEdit,
} from "../vault/proposal-apply.js";
import { VaultManager } from "../vault/vault-manager.js";

// --- Pure section-edit core ---

const BRIEF_BODY = `# Brief: Demo

## Overview
Old overview line.

## Key Hooks
- useFoo: does foo
- useBar: does bar

## Gotchas
- watch out for X
`;

describe("applySectionEdits", () => {
  it("replaces a section body, preserving the heading and other sections", () => {
    const edits: ProposalEdit[] = [
      { section: "Overview", action: "replace", content: "Brand new overview." },
    ];
    const { body, changed } = applySectionEdits(BRIEF_BODY, edits);
    expect(body).toContain("## Overview\nBrand new overview.");
    expect(body).not.toContain("Old overview line.");
    expect(body).toContain("- useFoo: does foo"); // untouched
    expect(body).toContain("## Gotchas"); // untouched
    expect(changed).toEqual(["Overview"]);
  });

  it("appends to an existing section before the next heading", () => {
    const edits: ProposalEdit[] = [
      { section: "Key Hooks", action: "append", content: "- useBaz: does baz" },
    ];
    const { body } = applySectionEdits(BRIEF_BODY, edits);
    expect(body).toContain("- useBar: does bar"); // kept
    expect(body).toContain("- useBaz: does baz"); // added
    // new line lands within Key Hooks, before Gotchas
    expect(body.indexOf("- useBaz: does baz")).toBeLessThan(body.indexOf("## Gotchas"));
  });

  it("creates a new section at end when appending to a missing section", () => {
    const edits: ProposalEdit[] = [
      { section: "Migration Status", action: "append", content: "- done" },
    ];
    const { body, changed } = applySectionEdits(BRIEF_BODY, edits);
    expect(body).toContain("## Migration Status\n\n- done");
    expect(changed).toContain("Migration Status");
  });

  it("throws when replacing a section that does not exist", () => {
    const edits: ProposalEdit[] = [
      { section: "Nonexistent", action: "replace", content: "x" },
    ];
    expect(() => applySectionEdits(BRIEF_BODY, edits)).toThrow(/Nonexistent/);
  });

  it("appends to the last section at EOF", () => {
    const edits: ProposalEdit[] = [
      { section: "Gotchas", action: "append", content: "- also watch out for Y" },
    ];
    const { body } = applySectionEdits(BRIEF_BODY, edits);
    expect(body).toContain("- watch out for X");
    expect(body.trimEnd().endsWith("- also watch out for Y")).toBe(true);
  });

  it("applies multiple edits in order and reports all changed sections", () => {
    const edits: ProposalEdit[] = [
      { section: "Overview", action: "replace", content: "New." },
      { section: "Gotchas", action: "append", content: "- Y" },
    ];
    const { body, changed } = applySectionEdits(BRIEF_BODY, edits);
    expect(body).toContain("## Overview\nNew.");
    expect(body).toContain("- Y");
    expect(changed).toEqual(["Overview", "Gotchas"]);
  });

  it("matches section headings case-insensitively", () => {
    const edits: ProposalEdit[] = [
      { section: "key hooks", action: "append", content: "- useQux" },
    ];
    const { body } = applySectionEdits(BRIEF_BODY, edits);
    expect(body).toContain("- useQux");
  });

  // Regression: briefs use H3 (### ) sections too — the matcher must handle
  // any heading level, not just H2 (found by the first autonomous run).
  const H3_BODY = `# Brief

## Phase 4a
Intro.

### Step 7 Idle Timeout
15-minute idle timeout.

### Step 8 Cleanup
Drop the table.

## Notes
- note one
`;

  it("replaces an H3 section without touching its siblings", () => {
    const { body, changed } = applySectionEdits(H3_BODY, [
      { section: "Step 7 Idle Timeout", action: "replace", content: "2-hour idle timeout." },
    ]);
    expect(body).toContain("### Step 7 Idle Timeout\n2-hour idle timeout.");
    expect(body).not.toContain("15-minute idle timeout.");
    expect(body).toContain("### Step 8 Cleanup"); // sibling intact
    expect(body).toContain("Drop the table."); // sibling body intact
    expect(changed).toEqual(["Step 7 Idle Timeout"]);
  });

  it("appends to an existing H3 section instead of creating a duplicate", () => {
    const { body } = applySectionEdits(H3_BODY, [
      { section: "Step 8 Cleanup", action: "append", content: "- also drop the index" },
    ]);
    // exactly one "Step 8 Cleanup" heading — no spurious duplicate at EOF
    expect(body.match(/Step 8 Cleanup/g)?.length).toBe(1);
    expect(body).toContain("- also drop the index");
    // the new line lands inside Step 8, before the next H2 (## Notes)
    expect(body.indexOf("- also drop the index")).toBeLessThan(body.indexOf("## Notes"));
  });

  it("replacing an H2 spans its H3 subsections (ends at the next H2)", () => {
    const { body } = applySectionEdits(H3_BODY, [
      { section: "Phase 4a", action: "replace", content: "Rewritten." },
    ]);
    expect(body).toContain("## Phase 4a\nRewritten.");
    expect(body).not.toContain("### Step 7"); // subsections swallowed by the replace
    expect(body).toContain("## Notes"); // next H2 preserved
    expect(body).toContain("- note one");
  });
});

describe("parseEdits", () => {
  it("normalizes a valid edits array", () => {
    const edits = parseEdits({
      edits: [{ section: "A", action: "append", content: "x" }],
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({ section: "A", action: "append", content: "x" });
  });
  it("returns [] when edits missing or malformed", () => {
    expect(parseEdits({})).toEqual([]);
    expect(parseEdits({ edits: "nope" })).toEqual([]);
    expect(parseEdits({ edits: [{ section: "A" }] })).toEqual([]); // missing action/content
  });
});

// --- Integration against a temp vault ---

let vaultRoot: string;
let vault: VaultManager;

async function writeNote(rel: string, fmYaml: string, body: string) {
  const abs = path.join(vaultRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `---\n${fmYaml}\n---\n\n${body}`);
}

beforeEach(async () => {
  // realpath resolves the /var -> /private/var symlink on macOS so
  // VaultManager's path-safety check (which realpaths) doesn't reject.
  vaultRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "proposal-test-")));
  vault = new VaultManager(vaultRoot); // no git options -> no commits in tests
});
afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

describe("applyProposal", () => {
  async function seed() {
    await writeNote(
      "05-Kitchen/brief-demo.md",
      "title: 'Brief: Demo'\ntags:\n  - type/brief\nlast_reviewed: '2026-05-01'",
      "# Brief: Demo\n\n## Overview\nOld overview.\n\n## Gotchas\n- X\n"
    );
    await writeNote(
      "proposals/brief-updates/2026-W26-brief-demo.md",
      [
        "title: 'Brief update proposal: Demo'",
        "tags:",
        "  - type/brief-proposal",
        "status: proposed",
        "confidence: high",
        "target_brief: 05-Kitchen/brief-demo.md",
        "edits:",
        "  - section: Overview",
        "    action: replace",
        "    content: Updated overview.",
        "  - section: Gotchas",
        "    action: append",
        "    content: '- Y'",
      ].join("\n"),
      "## Why\nSessions changed it.\n"
    );
  }

  it("applies edits, stamps last_reviewed, flips status, records an Applied note", async () => {
    await seed();
    const res = await applyProposal(vault, "proposals/brief-updates/2026-W26-brief-demo.md", {
      today: "2026-06-27",
    });

    expect(res.briefPath).toBe("05-Kitchen/brief-demo.md");
    expect(res.sectionsChanged).toEqual(["Overview", "Gotchas"]);
    expect(res.lastReviewed).toBe("2026-06-27");

    const brief = await vault.read("05-Kitchen/brief-demo.md");
    expect(brief.content).toContain("## Overview\nUpdated overview.");
    expect(brief.content).toContain("- Y");
    expect(brief.frontmatter.last_reviewed).toBe("2026-06-27");

    const proposal = await vault.read("proposals/brief-updates/2026-W26-brief-demo.md");
    expect(proposal.frontmatter.status).toBe("applied");
    expect(proposal.content).toContain("## Applied");
  });

  it("throws if the proposal is not in 'proposed' status", async () => {
    await seed();
    await vault.update("proposals/brief-updates/2026-W26-brief-demo.md", {
      frontmatter: { status: "applied" },
    });
    await expect(
      applyProposal(vault, "proposals/brief-updates/2026-W26-brief-demo.md")
    ).rejects.toThrow(/proposed/);
  });

  it("throws for a prose-only proposal with no structured edits", async () => {
    await writeNote(
      "05-Kitchen/brief-demo.md",
      "title: Demo\ntags:\n  - type/brief",
      "# Demo\n\n## Overview\nx\n"
    );
    await writeNote(
      "proposals/brief-updates/p.md",
      "status: proposed\ntarget_brief: 05-Kitchen/brief-demo.md",
      "## Proposed changes\n- UPDATE Overview: do stuff\n"
    );
    await expect(
      applyProposal(vault, "proposals/brief-updates/p.md")
    ).rejects.toThrow(/no structured edits/i);
  });
});

describe("findApplicableProposals", () => {
  it("returns only proposed proposals with edits, filtered by confidence", async () => {
    await writeNote(
      "proposals/brief-updates/high.md",
      "status: proposed\nconfidence: high\ntarget_brief: a.md\nedits:\n  - section: S\n    action: append\n    content: x",
      "body"
    );
    await writeNote(
      "proposals/brief-updates/low.md",
      "status: proposed\nconfidence: low\ntarget_brief: b.md\nedits:\n  - section: S\n    action: append\n    content: x",
      "body"
    );
    await writeNote(
      "proposals/brief-updates/applied.md",
      "status: applied\nconfidence: high\ntarget_brief: c.md\nedits:\n  - section: S\n    action: append\n    content: x",
      "body"
    );
    await writeNote(
      "proposals/brief-updates/prose.md",
      "status: proposed\nconfidence: high\ntarget_brief: d.md",
      "body"
    );

    const high = await findApplicableProposals(vaultRoot, { confidence: "high" });
    expect(high.map((p) => p.path).sort()).toEqual(["proposals/brief-updates/high.md"]);

    const all = await findApplicableProposals(vaultRoot);
    expect(all.map((p) => p.path).sort()).toEqual([
      "proposals/brief-updates/high.md",
      "proposals/brief-updates/low.md",
    ]);
  });
});
