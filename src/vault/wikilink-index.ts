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
 * Read a note's frontmatter `aliases` into a normalized list. Obsidian
 * accepts either a YAML sequence or a single/comma-separated string.
 */
function extractAliases(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.aliases ?? frontmatter.alias;
  if (Array.isArray(raw)) {
    return raw.filter((a): a is string => typeof a === "string");
  }
  if (typeof raw === "string") {
    return raw.split(",").map((a) => a.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Build a forward/back link graph over the vault. Targets resolve
 * Obsidian-style, in precedence order: exact relative path (with or without
 * `.md`), then basename, then frontmatter `aliases`, then frontmatter
 * `title`. The title/alias fallbacks mirror how Obsidian resolves links that
 * point at a note's display name when the file itself is slug-named.
 * Collisions within any tier resolve deterministically to the shortest
 * (then lexicographically first) path.
 */
export function buildWikilinkIndex(notes: NoteFile[]): WikilinkIndex {
  // basename -> candidate paths (for basename resolution)
  const byBasename = new Map<string, string[]>();
  // normalized full relative path -> path (for path-style links)
  const byPath = new Map<string, string>();
  // normalized frontmatter alias -> candidate paths
  const byAlias = new Map<string, string[]>();
  // normalized frontmatter title -> candidate paths
  const byTitle = new Map<string, string[]>();

  const addCandidate = (map: Map<string, string[]>, key: string, path: string) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    list.push(path);
    map.set(key, list);
  };

  for (const note of notes) {
    byPath.set(normalize(note.relativePath), note.relativePath);
    addCandidate(byBasename, note.basename.toLowerCase(), note.relativePath);
    addCandidate(byTitle, normalize(note.title), note.relativePath);
    for (const alias of extractAliases(note.frontmatter)) {
      addCandidate(byAlias, normalize(alias), note.relativePath);
    }
  }

  const pickShortest = (candidates: string[]): string =>
    [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];

  function resolve(target: string): string | null {
    const norm = normalize(target);
    if (byPath.has(norm)) return byPath.get(norm)!;
    const base = norm.split("/").pop() ?? norm;
    // basename matches the file's basename; alias/title match the full target.
    const tiers: Array<[Map<string, string[]>, string]> = [
      [byBasename, base],
      [byAlias, norm],
      [byTitle, norm],
    ];
    for (const [map, key] of tiers) {
      const candidates = map.get(key);
      if (candidates && candidates.length > 0) return pickShortest(candidates);
    }
    return null;
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
