import fs from "node:fs/promises";
import path from "node:path";
import { parseNote, extractTitle, extractTags } from "./frontmatter.js";

export interface NoteFile {
  relativePath: string;
  /** Filename without the .md extension (Obsidian wikilink target). */
  basename: string;
  title: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Read every markdown note in the vault (skipping hidden dirs like .obsidian
 * and .git). Pure filesystem walk — mirrors VaultManager.getAllNotes() but
 * without needing a VaultManager instance, so CLI scripts and analysis
 * functions can share it the same way they share findSessionNotes().
 */
export async function readAllNotes(vaultRoot: string): Promise<NoteFile[]> {
  const notes: NoteFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const raw = await fs.readFile(fullPath, "utf-8");
          const { frontmatter, content } = parseNote(raw);
          const relativePath = path.relative(vaultRoot, fullPath);
          notes.push({
            relativePath,
            basename: entry.name.replace(/\.md$/i, ""),
            title: extractTitle(frontmatter, content, relativePath),
            tags: extractTags(frontmatter, content),
            frontmatter,
            content,
          });
        } catch {
          // skip unreadable
        }
      }
    }
  }

  await walk(vaultRoot);
  return notes;
}

/** A note is a "map" (MOC/Home) if it organizes other notes. */
export function isMocNote(note: NoteFile): boolean {
  return (
    note.tags.includes("type/moc") ||
    note.relativePath.startsWith("MOCs/") ||
    note.basename === "Home"
  );
}

/** A note is "evergreen" curated knowledge that should be linked into the graph. */
export function isKnowledgeNote(note: NoteFile): boolean {
  return note.tags.includes("type/note") || note.tags.includes("type/reference");
}

export function topicTags(tags: string[]): string[] {
  return tags.filter((t) => t.startsWith("topic/"));
}
