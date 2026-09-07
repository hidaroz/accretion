import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VaultManager } from "../engine/vault/vault-manager.js";
import {
  PatchStringNotFoundError,
  PatchStringAmbiguousError,
  NoteNotFoundError,
} from "../engine/utils/errors.js";

let tmpRoot: string;
let vault: VaultManager;

async function writeNote(relativePath: string, raw: string): Promise<void> {
  const abs = path.join(tmpRoot, relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, raw, "utf-8");
}

async function readRaw(relativePath: string): Promise<string> {
  return fs.readFile(path.join(tmpRoot, relativePath), "utf-8");
}

beforeEach(async () => {
  // macOS tmpdir is symlinked (/var → /private/var); resolveSafePath compares
  // against realpath, so realpath the root up front to keep path checks consistent.
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), "accretion-patch-"));
  tmpRoot = await fs.realpath(raw);
  vault = new VaultManager(tmpRoot);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("VaultManager.patch", () => {
  it("applies a single edit and persists to disk", async () => {
    await writeNote("note.md", "Phase 2: 🟢 UNBLOCKED\n\nBody text.\n");

    const result = await vault.patch("note.md", [
      { old_string: "🟢 UNBLOCKED", new_string: "✅ COMPLETE" },
    ]);

    expect(result.content).toContain("✅ COMPLETE");
    expect(result.content).not.toContain("🟢 UNBLOCKED");

    const onDisk = await readRaw("note.md");
    expect(onDisk).toContain("✅ COMPLETE");
  });

  it("applies multiple edits sequentially (edit N sees edit N-1's output)", async () => {
    await writeNote("note.md", "alpha beta gamma\n");

    await vault.patch("note.md", [
      { old_string: "alpha", new_string: "ALPHA" },
      { old_string: "ALPHA beta", new_string: "ALPHA BETA" },
    ]);

    const onDisk = await readRaw("note.md");
    expect(onDisk).toContain("ALPHA BETA gamma");
  });

  it("throws PatchStringNotFoundError when old_string is absent", async () => {
    await writeNote("note.md", "hello world\n");

    await expect(
      vault.patch("note.md", [
        { old_string: "nonexistent", new_string: "X" },
      ])
    ).rejects.toBeInstanceOf(PatchStringNotFoundError);
  });

  it("throws PatchStringAmbiguousError when old_string matches >1 without replace_all", async () => {
    await writeNote("note.md", "foo foo foo\n");

    await expect(
      vault.patch("note.md", [{ old_string: "foo", new_string: "bar" }])
    ).rejects.toBeInstanceOf(PatchStringAmbiguousError);
  });

  it("replaces all occurrences when replace_all is true", async () => {
    await writeNote("note.md", "foo foo foo\n");

    await vault.patch("note.md", [
      { old_string: "foo", new_string: "bar", replace_all: true },
    ]);

    const onDisk = await readRaw("note.md");
    expect(onDisk.trim()).toBe("bar bar bar");
  });

  it("preserves frontmatter byte-for-byte", async () => {
    const raw =
      "---\ntitle: Test\ntags:\n  - foo\n  - bar\n---\n\nBody with STALE text.\n";
    await writeNote("note.md", raw);

    await vault.patch("note.md", [
      { old_string: "STALE", new_string: "FRESH" },
    ]);

    const onDisk = await readRaw("note.md");
    expect(onDisk).toContain("title: Test");
    expect(onDisk).toContain("- foo");
    expect(onDisk).toContain("- bar");
    expect(onDisk).toContain("FRESH");
    expect(onDisk).not.toContain("STALE");
  });

  it("throws NoteNotFoundError for a missing note", async () => {
    await expect(
      vault.patch("does-not-exist.md", [
        { old_string: "x", new_string: "y" },
      ])
    ).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("is atomic — a mid-batch failure leaves the file unchanged", async () => {
    const original = "alpha\nbeta\ngamma\n";
    await writeNote("note.md", original);

    await expect(
      vault.patch("note.md", [
        { old_string: "alpha", new_string: "ALPHA" },
        { old_string: "nonexistent", new_string: "X" },
        { old_string: "gamma", new_string: "GAMMA" },
      ])
    ).rejects.toBeInstanceOf(PatchStringNotFoundError);

    const onDisk = await readRaw("note.md");
    expect(onDisk).toBe(original);
  });
});
