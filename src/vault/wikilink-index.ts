import { stripCodeBlocks } from "./session-scan.js";
import type { NoteFile } from "./note-scan.js";

export interface WikilinkIndex {
  /** relativePath -> resolved target relativePaths it links to */
  forward: Map<string, Set<string>>;
  /** relativePath -> source relativePaths that link to it */
  backlinks: Map<string, Set<string>>;
  /** relativePath -> raw link targets that did not resolve to any note */
  dangling: Map<string, Set<string>>;
}

/**
 * Extract raw wikilink targets from note body content. Handles
 * `[[target]]`, `[[target|alias]]`, `[[target#heading]]`, and embeds
 * `![[target]]`. Links inside fenced code blocks are ignored. The returned
 * targets are the bare target portion (alias and heading stripped, trimmed).
 */
export function parseWikilinks(content: string): string[] {
  // Strip fenced blocks, then inline code spans, so neither `[[x]]` in code
  // nor a Next.js catch-all route like `/studio/[[...tool]]` is mistaken for
  // a wikilink.
  const stripped = stripCodeBlocks(content).replace(/`[^`\n]*`/g, "");
  const targets: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(stripped)) !== null) {
    const raw = match[1].split("|")[0].split("#")[0].trim();
    // Skip empties and Next.js optional catch-all segments ([[...slug]]),
    // which are never real Obsidian note targets.
    if (raw && !raw.startsWith("...")) targets.push(raw);
  }
  return targets;
}

/**
 * Normalize a link target or note path for resolution: drop a trailing
 * `.md`, lowercase, and use forward slashes.
 */
function normalize(target: string): string {
  return target.replace(/\.md$/i, "").replace(/\\/g, "/").toLowerCase();
}

/**
 * Build a forward/back link graph over the vault. Targets resolve
 * Obsidian-style: first by exact relative path (with or without `.md`),
 * then by basename. Basename collisions resolve deterministically to the
 * shortest (then lexicographically first) path.
 */
export function buildWikilinkIndex(notes: NoteFile[]): WikilinkIndex {
  // basename -> candidate paths (for basename resolution)
  const byBasename = new Map<string, string[]>();
  // normalized full relative path -> path (for path-style links)
  const byPath = new Map<string, string>();

  for (const note of notes) {
    byPath.set(normalize(note.relativePath), note.relativePath);
    const key = note.basename.toLowerCase();
    const list = byBasename.get(key) ?? [];
    list.push(note.relativePath);
    byBasename.set(key, list);
  }

  function resolve(target: string): string | null {
    const norm = normalize(target);
    if (byPath.has(norm)) return byPath.get(norm)!;
    const base = norm.split("/").pop() ?? norm;
    const candidates = byBasename.get(base);
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    return [...candidates].sort(
      (a, b) => a.length - b.length || a.localeCompare(b)
    )[0];
  }

  const forward = new Map<string, Set<string>>();
  const backlinks = new Map<string, Set<string>>();
  const dangling = new Map<string, Set<string>>();

  for (const note of notes) {
    const fwd = new Set<string>();
    for (const target of parseWikilinks(note.content)) {
      const resolved = resolve(target);
      if (resolved && resolved !== note.relativePath) {
        fwd.add(resolved);
        if (!backlinks.has(resolved)) backlinks.set(resolved, new Set());
        backlinks.get(resolved)!.add(note.relativePath);
      } else if (!resolved) {
        if (!dangling.has(note.relativePath))
          dangling.set(note.relativePath, new Set());
        dangling.get(note.relativePath)!.add(target);
      }
    }
    forward.set(note.relativePath, fwd);
  }

  return { forward, backlinks, dangling };
}
