// Persist the keyword index between processes so a one-shot CLI call does not
// re-read and re-index every note. The snapshot carries per-note mtime/size, so
// a load compares against the filesystem and re-indexes only what changed.
// The interface is deliberately small: swapping JSON for sqlite later is a new
// IndexStore, not a retrieval change.

import fs from "node:fs/promises";
import path from "node:path";
import { SearchIndex, type SearchSnapshot } from "./search-index.js";
import type { VaultManager, NoteContent } from "../vault/vault-manager.js";

export interface IndexStore {
  load(): Promise<SearchSnapshot | null>;
  save(snapshot: SearchSnapshot): Promise<void>;
}

export class JsonIndexStore implements IndexStore {
  constructor(private filePath: string) {}

  async load(): Promise<SearchSnapshot | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as SearchSnapshot;
      if (parsed?.version !== 1) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async save(snapshot: SearchSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot), "utf-8");
    await fs.rename(tmp, this.filePath);
  }
}

/** Relative path → mtime ISO + size for every .md note, without reading bodies. */
export async function statNotes(
  vaultRoot: string
): Promise<Map<string, { modifiedAt: string; size: number }>> {
  const out = new Map<string, { modifiedAt: string; size: number }>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith(".md")) {
        const st = await fs.stat(full);
        out.set(path.relative(vaultRoot, full), {
          modifiedAt: st.mtime.toISOString(),
          size: st.size,
        });
      }
    }
  }
  await walk(vaultRoot);
  return out;
}

export interface LoadedIndex {
  index: SearchIndex;
  /** All notes, only when a full read was needed (no usable snapshot). */
  notes: NoteContent[] | null;
  rebuilt: boolean;
  refreshed: number;
  removed: number;
}

/**
 * Load the snapshot and bring it up to date against the filesystem, or build
 * from scratch when there is no snapshot. Saves back when anything changed.
 */
export async function loadOrBuildSearchIndex(
  vault: VaultManager,
  store: IndexStore | null,
  options: { now?: () => number } = {}
): Promise<LoadedIndex> {
  const snapshot = store ? await store.load() : null;

  if (!snapshot) {
    const notes = await vault.getAllNotes();
    const index = new SearchIndex({ now: options.now });
    await index.buildFromVault(vault, notes);
    if (store) await store.save(index.toSnapshot());
    return { index, notes, rebuilt: true, refreshed: notes.length, removed: 0 };
  }

  const index = SearchIndex.fromSnapshot(snapshot, { now: options.now });
  const onDisk = await statNotes(vault.root);
  const known = new Map(snapshot.noteInfos.map((n) => [n.path, n]));

  let refreshed = 0;
  let removed = 0;
  for (const [rel, st] of onDisk) {
    const k = known.get(rel);
    if (k && k.modifiedAt === st.modifiedAt && k.size === st.size) continue;
    try {
      index.addOrUpdate(await vault.read(rel));
      refreshed++;
    } catch {
      // unreadable now; leave whatever the snapshot had
    }
  }
  for (const rel of known.keys()) {
    if (!onDisk.has(rel)) {
      index.remove(rel);
      removed++;
    }
  }
  if (store && (refreshed > 0 || removed > 0)) await store.save(index.toSnapshot());
  return { index, notes: null, rebuilt: false, refreshed, removed };
}
