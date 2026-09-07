import type { VaultManager } from "./vault-manager.js";
import { extractTags } from "./frontmatter.js";
import { logger } from "../utils/logger.js";

export interface TagInfo {
  tag: string;
  count: number;
}

export class TagIndex {
  // tag -> set of note paths
  private tagToNotes = new Map<string, Set<string>>();
  // note path -> set of tags
  private noteToTags = new Map<string, Set<string>>();

  async buildFromVault(vault: VaultManager, preloaded?: Awaited<ReturnType<VaultManager["getAllNotes"]>>): Promise<void> {
    this.tagToNotes.clear();
    this.noteToTags.clear();

    const notes = preloaded ?? await vault.getAllNotes();

    for (const note of notes) {
      this.addNote(note.path, note.tags);
    }

    logger.info(
      `Tag index built: ${this.tagToNotes.size} unique tags across ${this.noteToTags.size} notes`
    );
  }

  addNote(path: string, tags: string[]): void {
    // Remove old tags for this note if it existed
    this.removeNote(path);

    const tagSet = new Set(tags);
    this.noteToTags.set(path, tagSet);

    for (const tag of tagSet) {
      if (!this.tagToNotes.has(tag)) {
        this.tagToNotes.set(tag, new Set());
      }
      this.tagToNotes.get(tag)!.add(path);
    }
  }

  removeNote(path: string): void {
    const existingTags = this.noteToTags.get(path);
    if (existingTags) {
      for (const tag of existingTags) {
        const notes = this.tagToNotes.get(tag);
        if (notes) {
          notes.delete(path);
          if (notes.size === 0) {
            this.tagToNotes.delete(tag);
          }
        }
      }
      this.noteToTags.delete(path);
    }
  }

  getAllTags(prefix?: string): TagInfo[] {
    const results: TagInfo[] = [];

    for (const [tag, notes] of this.tagToNotes) {
      if (prefix && !tag.startsWith(prefix.toLowerCase())) continue;
      results.push({ tag, count: notes.size });
    }

    return results.sort((a, b) => b.count - a.count);
  }

  getNotesByTag(tag: string): string[] {
    const notes = this.tagToNotes.get(tag.toLowerCase());
    return notes ? Array.from(notes) : [];
  }
}
