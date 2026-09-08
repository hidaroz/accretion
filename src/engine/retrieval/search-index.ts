import MiniSearch, { type Options as MiniSearchOptions } from "minisearch";
import type { VaultManager, NoteContent, NoteInfo } from "../vault/vault-manager.js";
import { logger } from "../utils/logger.js";
import { SESSION_KEYWORD_BOOST, DIGEST_KEYWORD_BOOST } from "./weights.js";
import { buildBriefMap, isRoutableTagSet, keywordsFromFrontmatter } from "./brief-keywords.js";

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  tags: string[];
}

export interface IndexedDoc {
  id: string;
  title: string;
  tags: string;
  content: string;
  folder: string;
  rawTags: string[];
  createdAt: string;
  /** Routing keywords declared in frontmatter (briefs, playbooks, rejected). */
  keywords: string[];
}

/** Serialised keyword index plus the per-note stats needed to refresh it. */
export interface SearchSnapshot {
  version: 1;
  builtAt: string;
  minisearch: string;
  docs: IndexedDoc[];
  noteInfos: NoteInfo[];
}

const MINISEARCH_OPTIONS: MiniSearchOptions<IndexedDoc> = {
  fields: ["title", "tags", "content"],
  storeFields: ["title", "tags", "folder", "rawTags", "createdAt"],
  searchOptions: {
    boost: { title: 3, tags: 2, content: 1 },
    prefix: true,
    fuzzy: 0.2,
  },
};

export interface SearchOptions {
  folder?: string;
  /** Exact tag filter. */
  tag?: string;
  /** Any-of tag filter (used by routing to span brief-like note types). */
  tags?: string[];
  limit?: number;
}

export class SearchIndex {
  private index: MiniSearch<IndexedDoc>;
  private docs = new Map<string, IndexedDoc>();
  private noteInfos = new Map<string, NoteInfo>();
  /** Clock for recency boosts. Injectable so the eval harness can freeze it
   *  (Date.now() makes scorecards drift as notes age past 7/30-day thresholds). */
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.index = new MiniSearch<IndexedDoc>(MINISEARCH_OPTIONS);
  }

  static fromSnapshot(snapshot: SearchSnapshot, opts: { now?: () => number } = {}): SearchIndex {
    const idx = new SearchIndex(opts);
    idx.index = MiniSearch.loadJSON<IndexedDoc>(snapshot.minisearch, MINISEARCH_OPTIONS);
    for (const d of snapshot.docs) idx.docs.set(d.id, { ...d, keywords: d.keywords ?? [] });
    for (const n of snapshot.noteInfos) idx.noteInfos.set(n.path, n);
    return idx;
  }

  toSnapshot(): SearchSnapshot {
    return {
      version: 1,
      builtAt: new Date().toISOString(),
      minisearch: JSON.stringify(this.index),
      docs: [...this.docs.values()],
      noteInfos: [...this.noteInfos.values()],
    };
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

  /**
   * Routing map = frontmatter keywords of routable notes, overridden by the
   * explicit file map. Cheap enough to recompute after every index change.
   */
  briefMap(fileMap: Record<string, string> = {}): Record<string, string> {
    const notes = [...this.docs.values()].map((d) => ({
      path: d.id,
      tags: d.rawTags,
      frontmatter: { keywords: d.keywords },
    }));
    return buildBriefMap(notes, fileMap);
  }

  /** Notes that are not raw session journals: the curated layer. */
  get curatedCount(): number {
    let n = 0;
    for (const p of this.noteInfos.keys()) {
      if (!(p.startsWith("sessions/") && !p.startsWith("sessions/digests/"))) n++;
    }
    return n;
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

  search(query: string, options?: SearchOptions): SearchResult[] {
    const limit = options?.limit ?? 10;
    const tagFilter = (options?.tags ?? (options?.tag ? [options.tag] : [])).map((t) =>
      t.toLowerCase()
    );
    const explicitSessionSearch = tagFilter.includes("type/session");
    const now = this.now();
    const SEVEN_DAYS = 7 * 24 * 3600000;
    const THIRTY_DAYS = 30 * 24 * 3600000;

    let results = this.index.search(query, {
      boostDocument: (
        _id: string,
        _term: string,
        storedFields?: Record<string, unknown>
      ) => {
        let boost = 1;

        const createdAt = storedFields?.createdAt as string | undefined;
        if (createdAt) {
          const ageMs = now - new Date(createdAt).getTime();
          if (ageMs <= 0) boost *= 1.5;
          else if (ageMs <= SEVEN_DAYS) boost *= 1.3;
          else if (ageMs > THIRTY_DAYS) boost *= 0.7;
        }

        const tags = storedFields?.rawTags as string[] | undefined;

        if (!explicitSessionSearch && tags?.some((t) => t === "type/session")) {
          boost *= SESSION_KEYWORD_BOOST;
        }

        if (tags?.some((t) => t === "type/digest")) {
          boost *= DIGEST_KEYWORD_BOOST;
        }

        return boost;
      },
    });

    // Post-filter by folder
    if (options?.folder) {
      const prefix = options.folder.endsWith("/")
        ? options.folder
        : options.folder + "/";
      results = results.filter(
        (r) => r.id === options.folder || r.id.startsWith(prefix)
      );
    }

    // Post-filter by tag(s): any-of
    if (tagFilter.length > 0) {
      results = results.filter((r) => {
        const rawTags = (r as unknown as { rawTags: string[] }).rawTags;
        return rawTags?.some((t: string) => tagFilter.includes(t.toLowerCase()));
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

  /** Tag → note count, optionally filtered by prefix, most common first. */
  tagCounts(prefix?: string): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>();
    for (const d of this.docs.values()) {
      for (const t of d.rawTags) {
        if (prefix && !t.startsWith(prefix.toLowerCase())) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** The indexed document (title, content, tags) for a path, if indexed. */
  getDoc(relativePath: string): { title: string; content: string; tags: string[] } | undefined {
    const d = this.docs.get(relativePath);
    return d ? { title: d.title, content: d.content, tags: d.rawTags } : undefined;
  }

  get size(): number {
    return this.docs.size;
  }

  private toNoteInfo(note: NoteContent): NoteInfo {
    return {
      path: note.path,
      title: note.title,
      tags: note.tags,
      createdAt: note.createdAt,
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
      createdAt: note.createdAt,
      keywords: isRoutableTagSet(note.tags) ? keywordsFromFrontmatter(note.frontmatter) : [],
    };
  }

  private generateSnippet(docId: string, query: string): string {
    const doc = this.docs.get(docId);
    if (!doc) return "";

    const content = doc.content;
    const isSession = doc.rawTags.some((t) => t === "type/session");

    // Prefer TL;DR line if present (agent briefs)
    const tldrMatch = content.match(/^>\s*TL;DR[:\s](.+)$/m);
    if (tldrMatch) return tldrMatch[1].trim();

    // For session notes: prefer Topics section
    if (isSession) {
      const topicsMatch = content.match(/## Topics\n([\s\S]*?)(?=\n##|\n$)/);
      if (topicsMatch) {
        const topics = topicsMatch[1].trim();
        return topics.length > 400 ? topics.slice(0, 400) + "..." : topics;
      }
    }

    // Prefer Key Facts section if present
    const factsMatch = content.match(/## Key Facts\n([\s\S]*?)(?=\n##|\n$)/);
    if (factsMatch) {
      const facts = factsMatch[1].trim();
      return facts.length > 300 ? facts.slice(0, 300) + "..." : facts;
    }

    // Fall back to keyword-proximity snippet (wider for sessions)
    const words = query.toLowerCase().split(/\s+/);
    const windowBefore = isSession ? 120 : 80;
    const windowAfter = isSession ? 280 : 120;

    let bestPos = 0;
    for (const word of words) {
      const pos = content.toLowerCase().indexOf(word);
      if (pos >= 0) {
        bestPos = pos;
        break;
      }
    }

    const start = Math.max(0, bestPos - windowBefore);
    const end = Math.min(content.length, bestPos + windowAfter);
    let snippet = content.slice(start, end).trim();

    if (start > 0) snippet = "..." + snippet;
    if (end < content.length) snippet = snippet + "...";

    return snippet.replace(/\n+/g, " ");
  }
}
