// Structural health as named lint rules. The names are the six checks a
// knowledge base needs (contradiction, stale, orphan, missing-page,
// missing-link, gap) plus two mechanical ones this engine can run without a
// model. `stale` is produced by brief-staleness; `contradiction` and `gap` need
// judgment and are steps in the weekly skill, not here.

import { readAllNotes, type NoteFile } from "../vault/note-scan.js";
import { findOrphanNotes } from "./orphan-detection.js";
import { validateStructure } from "./structure-validation.js";
import { findNewDomainCandidates } from "./domain-candidates.js";
import { readValidity } from "../context/validity.js";
import { isRoutableTagSet } from "../retrieval/brief-keywords.js";

export type GardenRule =
  | "orphan"
  | "missing-link"
  | "missing-page"
  | "stale"
  | "stale-reference"
  | "missing-provenance";

export const GARDEN_RULES: Record<GardenRule, string> = {
  orphan: "knowledge note reachable from no MOC, or linked from nowhere",
  "missing-link": "dangling wikilink, or a MOC that Home does not link to",
  "missing-page": "a topic tag cluster large enough to deserve its own MOC",
  stale: "a routable note past its review_by, superseded by another note, or a brief not reviewed within staleDays",
  "stale-reference":
    "a durable note cites a source path or line number; those go stale, describe behaviour instead",
  "missing-provenance":
    "a generated or evergreen note with no pointer back to what it was made from",
};

export interface GardenIssue {
  rule: GardenRule;
  path: string;
  detail: string;
}

export interface GardenResult {
  issues: GardenIssue[];
  /** Net-growth signal: a vault that only ever grows is not being curated. */
  briefStats: { count: number; totalChars: number };
  rules: Record<GardenRule, string>;
}

export interface GardenOptions {
  rules?: GardenRule[];
  /** Min notes for a topic cluster to be a missing-page candidate (default 3). */
  threshold?: number;
  /** Days since last_reviewed after which a brief is stale (default 90). */
  staleDays?: number;
  /** Injected clock for tests. */
  now?: Date;
}

const DURABLE_TAGS = ["type/brief", "type/note", "type/reference", "type/playbook"];

// Path-like references into a codebase, and line numbers attached to them.
const SOURCE_PATH = /(?:^|[\s(`'"])((?:src|lib|app|apps|packages|scripts|hooks|test|tests|bin|cmd|internal|pkg)\/[\w.@-]+(?:\/[\w.@-]+)*\.[a-z]{1,5})(?::\d+)?/g;
const LINE_REF = /(?:\b(?:line|lines)\s?\d{1,5}\b|#L\d{1,5}\b)/gi;

export function findStaleReferences(content: string): string[] {
  const hits = new Set<string>();
  for (const m of content.matchAll(SOURCE_PATH)) hits.add(m[1]);
  for (const m of content.matchAll(LINE_REF)) hits.add(m[0]);
  return [...hits];
}

function isGenerated(note: NoteFile): boolean {
  return (
    note.tags.includes("type/digest") ||
    note.relativePath.startsWith("proposals/") ||
    typeof note.frontmatter.generated_by === "string"
  );
}

function hasProvenance(note: NoteFile): boolean {
  const fm = note.frontmatter;
  const arr = (v: unknown) => Array.isArray(v) && v.length > 0;
  if (arr(fm.sources)) return true;
  if (typeof fm.source === "string" && fm.source.trim()) return true;
  if (typeof fm.provenance === "string" && fm.provenance.trim()) return true;
  if (note.relativePath.startsWith("proposals/")) {
    // A proposal cites the sessions that motivated it, in frontmatter or prose.
    if (arr(fm.sessions)) return true;
    if (/\[\[sessions\//.test(note.content) || /sessions\/\d{4}\//.test(note.content)) return true;
  }
  return false;
}

export async function runGarden(
  vaultRoot: string,
  options: GardenOptions = {},
  preloaded?: NoteFile[]
): Promise<GardenResult> {
  const notes = preloaded ?? (await readAllNotes(vaultRoot));
  const want = new Set<GardenRule>(
    options.rules ?? (Object.keys(GARDEN_RULES) as GardenRule[])
  );
  const issues: GardenIssue[] = [];

  if (want.has("orphan")) {
    for (const o of (await findOrphanNotes(vaultRoot, notes)).orphans) {
      issues.push({
        rule: "orphan",
        path: o.path,
        detail:
          o.reason === "isolated"
            ? `nothing links to "${o.title}"`
            : `no MOC links to "${o.title}" (${o.backlinkCount} other backlink(s))`,
      });
    }
  }

  if (want.has("missing-link") || want.has("missing-provenance")) {
    for (const s of (await validateStructure(vaultRoot, notes)).issues) {
      if (s.kind === "missing-source") {
        if (want.has("missing-provenance"))
          issues.push({ rule: "missing-provenance", path: s.path, detail: s.detail });
      } else if (want.has("missing-link")) {
        issues.push({ rule: "missing-link", path: s.path, detail: s.detail });
      }
    }
  }

  if (want.has("missing-page")) {
    const { candidates } = await findNewDomainCandidates(
      vaultRoot,
      { threshold: options.threshold ?? 3 },
      notes
    );
    for (const c of candidates) {
      issues.push({
        rule: "missing-page",
        path: c.tag,
        detail: `${c.noteCount} notes carry ${c.tag} and no MOC owns it`,
      });
    }
  }

  if (want.has("stale")) {
    const now = options.now ?? new Date();
    const staleDays = options.staleDays ?? 90;
    for (const n of notes) {
      if (!isRoutableTagSet(n.tags)) continue;
      const v = readValidity(n.frontmatter, now);
      if (v.supersededBy) {
        issues.push({ rule: "stale", path: n.relativePath, detail: `superseded by ${v.supersededBy}` });
        continue;
      }
      if (v.overdue) {
        issues.push({ rule: "stale", path: n.relativePath, detail: `review was due ${v.reviewBy}` });
        continue;
      }
      if (n.tags.includes("type/brief") && v.lastReviewed) {
        const age = Math.floor((now.getTime() - Date.parse(v.lastReviewed)) / 86_400_000);
        if (age > staleDays) issues.push({ rule: "stale", path: n.relativePath, detail: `last reviewed ${v.lastReviewed}, ${age} days ago` });
      }
    }
  }

  if (want.has("stale-reference")) {
    for (const n of notes) {
      if (!n.tags.some((t) => DURABLE_TAGS.includes(t))) continue;
      const refs = findStaleReferences(n.content);
      if (refs.length === 0) continue;
      issues.push({
        rule: "stale-reference",
        path: n.relativePath,
        detail: `cites ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? ` (+${refs.length - 3})` : ""}`,
      });
    }
  }

  if (want.has("missing-provenance")) {
    for (const n of notes) {
      if (!isGenerated(n) || hasProvenance(n)) continue;
      issues.push({
        rule: "missing-provenance",
        path: n.relativePath,
        detail: `generated note has no sources/source/provenance frontmatter`,
      });
    }
  }

  issues.sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path)
  );

  const briefs = notes.filter((n) => n.tags.includes("type/brief"));
  return {
    issues,
    briefStats: {
      count: briefs.length,
      totalChars: briefs.reduce((s, n) => s + n.content.length, 0),
    },
    rules: GARDEN_RULES,
  };
}
