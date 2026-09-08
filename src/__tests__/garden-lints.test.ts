import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGarden, findStaleReferences, GARDEN_RULES } from "../engine/lifecycle/garden.js";

async function write(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

describe("findStaleReferences", () => {
  it("finds source paths and line numbers, ignores prose", () => {
    const refs = findStaleReferences(
      "See src/vault/hybrid.ts and scripts/memory-eval.mjs:42, around line 17. The retrieval layer fuses ranks."
    );
    expect(refs).toContain("src/vault/hybrid.ts");
    expect(refs).toContain("scripts/memory-eval.mjs");
    expect(refs.some((r) => /line 17/i.test(r))).toBe(true);
    expect(findStaleReferences("Reciprocal-rank fusion combines rankings.")).toEqual([]);
  });
});

describe("runGarden", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-garden-")));
    await write(root, "Home.md", "---\ntags:\n  - type/moc\n---\n# Home\n\n[[brief-good]]\n");
    await write(
      root,
      "01-Arch/brief-good.md",
      "---\ntitle: Good\ntags:\n  - type/brief\n---\n# Good\n\nDescribes behaviour only.\n"
    );
    await write(
      root,
      "01-Arch/brief-stale.md",
      "---\ntitle: Stale\ntags:\n  - type/brief\n---\n# Stale\n\nEdit src/engine/retrieval/hybrid.ts at line 30.\n"
    );
    await write(
      root,
      "sessions/digests/2026-W36-x.md",
      "---\ntitle: W36\ntags:\n  - type/digest\ngenerated_by: memory-weekly\n---\n# W36\n\nno sources here\n"
    );
    await write(
      root,
      "sessions/digests/2026-W35-x.md",
      "---\ntitle: W35\ntags:\n  - type/digest\nsources:\n  - sessions/2026/08-30/x.md\n---\n# W35\n"
    );
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keys issues by rule name and reports brief stats", async () => {
    const result = await runGarden(root);
    const byRule = (rule: string) => result.issues.filter((i) => i.rule === rule).map((i) => i.path);

    expect(byRule("stale-reference")).toEqual(["01-Arch/brief-stale.md"]);
    expect(byRule("missing-provenance")).toEqual(["sessions/digests/2026-W36-x.md"]);
    expect(result.briefStats.count).toBe(2);
    expect(result.briefStats.totalChars).toBeGreaterThan(0);
    expect(Object.keys(result.rules)).toEqual(Object.keys(GARDEN_RULES));
  });

  it("honours a rule subset", async () => {
    const result = await runGarden(root, { rules: ["stale-reference"] });
    expect(result.issues.every((i) => i.rule === "stale-reference")).toBe(true);
  });
});
