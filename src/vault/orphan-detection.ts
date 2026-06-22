import { readAllNotes, isMocNote, isKnowledgeNote, type NoteFile } from "./note-scan.js";
import { buildWikilinkIndex } from "./wikilink-index.js";

export interface OrphanNote {
  path: string;
  title: string;
  /** "no-moc" = no MOC/Home links to it; "isolated" = no backlinks at all. */
  reason: "no-moc" | "isolated";
  backlinkCount: number;
}

export interface OrphanResult {
  orphans: OrphanNote[];
}

/**
 * Find knowledge notes (type/note, type/reference) that aren't reachable from
 * the vault's navigation layer. "no-moc" means no MOC or Home links to it (it
 * exists but you'd never find it by browsing); "isolated" means nothing links
 * to it at all.
 */
export async function findOrphanNotes(
  vaultRoot: string,
  preloaded?: NoteFile[]
): Promise<OrphanResult> {
  const notes = preloaded ?? (await readAllNotes(vaultRoot));
  const byPath = new Map(notes.map((n) => [n.relativePath, n]));
  const index = buildWikilinkIndex(notes);

  const orphans: OrphanNote[] = [];

  for (const note of notes) {
    if (!isKnowledgeNote(note)) continue;

    const sources = index.backlinks.get(note.relativePath);
    const backlinkCount = sources?.size ?? 0;

    if (backlinkCount === 0) {
      orphans.push({
        path: note.relativePath,
        title: note.title,
        reason: "isolated",
        backlinkCount,
      });
      continue;
    }

    const hasMocLink = [...(sources ?? [])].some((src) => {
      const srcNote = byPath.get(src);
      return srcNote ? isMocNote(srcNote) : false;
    });

    if (!hasMocLink) {
      orphans.push({
        path: note.relativePath,
        title: note.title,
        reason: "no-moc",
        backlinkCount,
      });
    }
  }

  orphans.sort((a, b) => a.path.localeCompare(b.path));
  return { orphans };
}
