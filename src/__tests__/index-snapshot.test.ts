import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VaultManager } from "../engine/vault/vault-manager.js";
import { SearchIndex } from "../engine/retrieval/search-index.js";
import { JsonIndexStore, loadOrBuildSearchIndex, statNotes } from "../engine/retrieval/index-store.js";

async function write(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

describe("search index snapshot", () => {
  let root: string;
  let vault: VaultManager;
  let store: JsonIndexStore;
  const now = () => Date.parse("2026-09-07T00:00:00Z");

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-snap-")));
    await write(root, "a.md", "---\ntitle: Alpha\ntags:\n  - type/brief\nkeywords:\n  - alpha\n---\n# Alpha\n\nalpha body\n");
    await write(root, "b.md", "---\ntitle: Beta\n---\n# Beta\n\nbeta body\n");
    vault = new VaultManager(root);
    store = new JsonIndexStore(path.join(root, ".mcp", "search-index.json"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("round-trips through toSnapshot/fromSnapshot with keywords and search intact", async () => {
    const idx = new SearchIndex({ now });
    await idx.buildFromVault(vault);
    const snap = idx.toSnapshot();
    const back = SearchIndex.fromSnapshot(snap, { now });
    expect(back.size).toBe(2);
    expect(back.search("alpha").map((r) => r.path)).toEqual(["a.md"]);
    expect(back.briefMap()).toEqual({ alpha: "a.md" });
    expect(back.listNotes().map((n) => n.path).sort()).toEqual(["a.md", "b.md"]);
  });

  it("builds and saves on first load, then refreshes only changed notes", async () => {
    const first = await loadOrBuildSearchIndex(vault, store, { now });
    expect(first.rebuilt).toBe(true);
    expect(first.notes).toHaveLength(2);
    expect(await store.load()).not.toBeNull();

    const second = await loadOrBuildSearchIndex(vault, store, { now });
    expect(second.rebuilt).toBe(false);
    expect(second.refreshed).toBe(0);
    expect(second.notes).toBeNull();

    // Change one, add one, delete one.
    await new Promise((r) => setTimeout(r, 20));
    await write(root, "b.md", "---\ntitle: Beta\n---\n# Beta\n\nbeta body now mentions gamma\n");
    await write(root, "c.md", "# Gamma\n\nnew note\n");
    await fs.rm(path.join(root, "a.md"));

    const third = await loadOrBuildSearchIndex(vault, store, { now });
    expect(third.rebuilt).toBe(false);
    expect(third.refreshed).toBe(2);
    expect(third.removed).toBe(1);
    expect(third.index.size).toBe(2);
    expect(third.index.search("gamma").map((r) => r.path).sort()).toEqual(["b.md", "c.md"]);
    expect(third.index.briefMap()).toEqual({});
  });

  it("statNotes skips hidden dirs", async () => {
    await write(root, ".obsidian/x.md", "hidden");
    const st = await statNotes(root);
    expect([...st.keys()].sort()).toEqual(["a.md", "b.md"]);
  });
});
