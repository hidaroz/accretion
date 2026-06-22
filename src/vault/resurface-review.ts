import { readAllNotes, topicTags, type NoteFile } from "./note-scan.js";

export interface ResurfaceCandidate {
  path: string;
  title: string;
  topics: string[];
  lastReviewed: string | null;
  ageDays: number;
}

export interface ResurfaceResult {
  /** Notes due for review, most overdue first. */
  candidates: ResurfaceCandidate[];
}

export interface ResurfaceOptions {
  /** Days since last review/creation before a note is "due" (default 14). */
  window?: number;
  /** Injected for deterministic tests; defaults to now. */
  now?: Date;
}

const DAY_MS = 86400000;

function baselineDate(fm: Record<string, unknown>): { date: Date | null; reviewed: string | null } {
  const reviewed = fm.last_reviewed ?? fm.reviewed;
  if (reviewed instanceof Date && !Number.isNaN(reviewed.getTime())) {
    return { date: reviewed, reviewed: reviewed.toISOString() };
  }
  if (typeof reviewed === "string") {
    const d = new Date(reviewed);
    if (!Number.isNaN(d.getTime())) return { date: d, reviewed };
  }
  // Never reviewed: fall back to authored date.
  const created = fm.date ?? fm.created;
  if (created instanceof Date && !Number.isNaN(created.getTime())) {
    return { date: created, reviewed: null };
  }
  if (typeof created === "string") {
    const d = new Date(created);
    if (!Number.isNaN(d.getTime())) return { date: d, reviewed: null };
  }
  return { date: null, reviewed: null };
}

/**
 * Build a spaced-review queue: evergreen notes (type/note) whose time since
 * last review (or authoring, if never reviewed) exceeds the window. This is
 * the "come back and understand deeply" surface — reviewing a note means
 * bumping its `last_reviewed` frontmatter.
 */
export async function findResurfaceCandidates(
  vaultRoot: string,
  options: ResurfaceOptions = {},
  preloaded?: NoteFile[]
): Promise<ResurfaceResult> {
  const window = options.window ?? 14;
  const now = options.now ?? new Date();
  const notes = preloaded ?? (await readAllNotes(vaultRoot));

  const candidates: ResurfaceCandidate[] = [];

  for (const note of notes) {
    if (!note.tags.includes("type/note")) continue;
    const { date, reviewed } = baselineDate(note.frontmatter);
    if (!date) continue;

    const ageDays = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
    if (ageDays < window) continue;

    candidates.push({
      path: note.relativePath,
      title: note.title,
      topics: topicTags(note.tags),
      lastReviewed: reviewed,
      ageDays,
    });
  }

  candidates.sort((a, b) => b.ageDays - a.ageDays || a.path.localeCompare(b.path));
  return { candidates };
}
