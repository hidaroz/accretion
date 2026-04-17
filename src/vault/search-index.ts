import MiniSearch from "minisearch";
import type { VaultManager, NoteContent, NoteInfo } from "./vault-manager.js";
import { logger } from "../utils/logger.js";

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  tags: string[];
}

interface IndexedDoc {
  id: string;
  title: string;
  tags: string;
  content: string;
  folder: string;
  rawTags: string[];
}

export class SearchIndex {
  private index: MiniSearch<IndexedDoc>;
  private docs = new Map<string, IndexedDoc>();
  private noteInfos = new Map<string, NoteInfo>();

  constructor() {
    this.index = new MiniSearch<IndexedDoc>({
      fields: ["title", "tags", "content"],
      storeFields: ["title", "tags", "folder", "rawTags"],
      searchOptions: {
        boost: { title: 3, tags: 2, content: 1 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
  }

  async buildFromVault(vault: VaultManager, preloaded?: NoteContent[]): Promise<void> {
    const notes = preloaded ?? await vault.getAllNotes();
    const docs = notes.map((n) => this.noteToDoc(n));

    this.index.removeAll();
    this.docs.clear();
    this.noteInfos.clear();

    this.index.addAll(docs);
    for (const doc of docs) {
      this.docs.set(doc.id, doc);
    }
    for (const note of notes) {
      this.noteInfos.set(note.path, this.toNoteInfo(note));
    }

    logger.info(`Search index built with ${docs.length} documents`);
  }

  addOrUpdate(note: NoteContent): void {
    const doc = this.noteToDoc(note);

    if (this.docs.has(doc.id)) {
      this.index.discard(doc.id);
    }

    this.index.add(doc);
    this.docs.set(doc.id, doc);
    this.noteInfos.set(note.path, this.toNoteInfo(note));
  }

  remove(relativePath: string): void {
    if (this.docs.has(relativePath)) {
      this.index.discard(relativePath);
      this.docs.delete(relativePath);
    }
    this.noteInfos.delete(relativePath);
  }

  listNotes(
    folder: string = "",
    recursive: boolean = true,
    limit: number = 100
  ): NoteInfo[] {
    const normalized = folder.replace(/\/+$/, "");
    const prefix = normalized ? normalized + "/" : "";

    const matches: NoteInfo[] = [];
    for (const info of this.noteInfos.values()) {
      if (!normalized) {
        // Root: recursive = all notes; non-recursive = only files without a "/"
        if (recursive || !info.path.includes("/")) matches.push(info);
        continue;
      }

      if (!info.path.startsWith(prefix)) continue;
      if (recursive) {
        matches.push(info);
      } else {
        const rest = info.path.slice(prefix.length);
        if (!rest.includes("/")) matches.push(info);
      }
    }

    matches.sort(
      (a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );
    return matches.slice(0, limit);
  }

  search(
    query: string,
    options?: { folder?: string; tag?: string; limit?: number }
  ): SearchResult[] {
    const limit = options?.limit ?? 10;

    let results = this.index.search(query);

    // Post-filter by folder
    if (options?.folder) {
      const prefix = options.folder.endsWith("/")
        ? options.folder
        : options.folder + "/";
      results = results.filter(
        (r) => r.id === options.folder || r.id.startsWith(prefix)
      );
    }

    // Post-filter by tag
    if (options?.tag) {
      const tagLower = options.tag.toLowerCase();
      results = results.filter((r) => {
        const rawTags = (r as unknown as { rawTags: string[] }).rawTags;
        return rawTags?.some((t: string) => t.toLowerCase() === tagLower);
      });
    }

    return results.slice(0, limit).map((r) => {
      const doc = this.docs.get(r.id);
      return {
        path: r.id,
        title: doc?.title || r.id,
        score: r.score,
        snippet: this.generateSnippet(r.id, query),
        tags: doc?.rawTags || [],
      };
    });
  }

  get size(): number {
    return this.docs.size;
  }

  private toNoteInfo(note: NoteContent): NoteInfo {
    return {
      path: note.path,
      title: note.title,
      tags: note.tags,
      modifiedAt: note.modifiedAt,
      size: note.size,
    };
  }

  private noteToDoc(note: NoteContent): IndexedDoc {
    const folder = note.path.includes("/")
      ? note.path.substring(0, note.path.lastIndexOf("/"))
      : "";

    return {
      id: note.path,
      title: note.title,
      tags: note.tags.join(" "),
      content: note.content,
      folder,
      rawTags: note.tags,
    };
  }

  private generateSnippet(docId: string, query: string): string {
    const doc = this.docs.get(docId);
    if (!doc) return "";

    const content = doc.content;

    // Prefer TL;DR line if present (agent briefs)
    const tldrMatch = content.match(/^>\s*TL;DR[:\s](.+)$/m);
    if (tldrMatch) return tldrMatch[1].trim();

    // Prefer Key Facts section if present
    const factsMatch = content.match(/## Key Facts\n([\s\S]*?)(?=\n##|\n$)/);
    if (factsMatch) {
      const facts = factsMatch[1].trim();
      return facts.length > 300 ? facts.slice(0, 300) + "..." : facts;
    }

    // Fall back to keyword-proximity snippet
    const words = query.toLowerCase().split(/\s+/);

    let bestPos = 0;
    for (const word of words) {
      const pos = content.toLowerCase().indexOf(word);
      if (pos >= 0) {
        bestPos = pos;
        break;
      }
    }

    const start = Math.max(0, bestPos - 80);
    const end = Math.min(content.length, bestPos + 120);
    let snippet = content.slice(start, end).trim();

    if (start > 0) snippet = "..." + snippet;
    if (end < content.length) snippet = snippet + "...";

    return snippet.replace(/\n+/g, " ");
  }
}
