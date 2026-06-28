import { readAllNotes, isMocNote, topicTags, type NoteFile } from "./note-scan.js";

export interface DomainCandidate {
  tag: string;
  noteCount: number;
}

export interface DomainCandidatesResult {
  candidates: DomainCandidate[];
}

export interface DomainCandidatesOptions {
  /** Minimum notes carrying a topic tag before it warrants its own MOC. */
  threshold?: number;
}

/**
 * Propose new knowledge domains: topic/* tag clusters that have grown past a
 * threshold of notes but have no MOC dedicated to them. The signal that the
 * vault needs a new map.
 */
export async function findNewDomainCandidates(
  vaultRoot: string,
  options: DomainCandidatesOptions = {},
  preloaded?: NoteFile[]
): Promise<DomainCandidatesResult> {
  const threshold = options.threshold ?? 3;
  const notes = preloaded ?? (await readAllNotes(vaultRoot));

  // Topic tags already owned by a MOC.
  const mocTopics = new Set<string>();
  for (const note of notes) {
    if (isMocNote(note)) {
      for (const t of topicTags(note.tags)) mocTopics.add(t);
    }
  }

  // Count non-MOC notes per topic tag.
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (isMocNote(note)) continue;
    for (const t of topicTags(note.tags)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }

  const candidates: DomainCandidate[] = [];
  for (const [tag, count] of counts) {
    if (count >= threshold && !mocTopics.has(tag)) {
      candidates.push({ tag, noteCount: count });
    }
  }

  candidates.sort((a, b) => b.noteCount - a.noteCount || a.tag.localeCompare(b.tag));
  return { candidates };
}
