// Routing keywords live on the note, not only in a side file. A brief (or a
// playbook, or a rejected-decision note) declares `keywords:` / `aliases:` in
// its frontmatter; `.mcp/brief-map.json` remains as an explicit override for
// keywords that should route somewhere other than the note that claims them.
// The merged map is what routing sees, so the side file becomes optional.

export const ROUTABLE_TAGS = ["type/brief", "type/playbook", "type/rejected"] as const;

export function isRoutableTagSet(tags: string[]): boolean {
  return tags.some((t) => (ROUTABLE_TAGS as readonly string[]).includes(t));
}

/** Lower-cased, trimmed keywords from `keywords` and `aliases` frontmatter. */
export function keywordsFromFrontmatter(fm: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const field of ["keywords", "aliases"]) {
    const v = fm[field];
    const items: unknown[] = Array.isArray(v)
      ? v
      : typeof v === "string"
        ? v.split(",")
        : [];
    for (const item of items) {
      if (typeof item !== "string") continue;
      const k = item.toLowerCase().trim();
      if (k) out.add(k);
    }
  }
  return [...out];
}

export interface RoutableNote {
  path: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
}

/**
 * Merge frontmatter keywords with the explicit file map. The file map wins on
 * conflict: it is the place a human writes "this word means that brief" on
 * purpose, and an alias on a note should not silently override it.
 */
export function buildBriefMap(
  notes: RoutableNote[],
  fileMap: Record<string, string> = {}
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const n of notes) {
    if (!isRoutableTagSet(n.tags)) continue;
    for (const k of keywordsFromFrontmatter(n.frontmatter)) {
      if (!(k in merged)) merged[k] = n.path;
    }
  }
  for (const [k, v] of Object.entries(fileMap)) {
    if (typeof v === "string" && v.trim()) merged[k.toLowerCase().trim()] = v;
  }
  return merged;
}

