import { readAllNotes, isMocNote, type NoteFile } from "./note-scan.js";
import { buildWikilinkIndex, parseWikilinks } from "./wikilink-index.js";

export type StructureIssueKind =
  | "moc-not-in-home"
  | "dangling-link"
  | "missing-source";

export interface StructureIssue {
  kind: StructureIssueKind;
  path: string;
  detail: string;
}

export interface StructureResult {
  issues: StructureIssue[];
}

const HOME = "Home.md";

/**
 * Structural health checks for a knowledge-base vault:
 *  - moc-not-in-home: a MOC that Home.md doesn't link to (unreachable hub).
 *  - dangling-link: a [[wikilink]] whose target note doesn't exist.
 *  - missing-source: an evergreen note (type/note) with no `Source:` backlink
 *    to the session/material it was mined from.
 */
export async function validateStructure(
  vaultRoot: string,
  preloaded?: NoteFile[]
): Promise<StructureResult> {
  const notes = preloaded ?? (await readAllNotes(vaultRoot));
  const index = buildWikilinkIndex(notes);
  const issues: StructureIssue[] = [];

  const homeForward = index.forward.get(HOME) ?? new Set<string>();

  for (const note of notes) {
    // MOCs (other than Home itself) should be reachable from Home.
    if (
      isMocNote(note) &&
      note.relativePath !== HOME &&
      !note.relativePath.startsWith("Knowledge/") // skip _conventions-style helpers
    ) {
      if (!homeForward.has(note.relativePath)) {
        issues.push({
          kind: "moc-not-in-home",
          path: note.relativePath,
          detail: `Home.md does not link to MOC "${note.title}"`,
        });
      }
    }

    // Evergreen notes must cite a Source.
    if (note.tags.includes("type/note")) {
      const hasSource = /(^|\n)\s*Source:\s*\[\[/.test(note.content);
      if (!hasSource) {
        issues.push({
          kind: "missing-source",
          path: note.relativePath,
          detail: `Evergreen note "${note.title}" has no Source: link`,
        });
      }
    }
  }

  // Dangling links in the curated layer only — the raw sessions/ archive is
  // full of file paths and command snippets that aren't real wikilinks.
  for (const [path, targets] of index.dangling) {
    if (path.startsWith("sessions/")) continue;
    for (const target of targets) {
      issues.push({
        kind: "dangling-link",
        path,
        detail: `unresolved [[${target}]]`,
      });
    }
  }

  issues.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path)
  );
  return { issues };
}

// Re-exported so callers can reason about a single note's links if needed.
export { parseWikilinks };
