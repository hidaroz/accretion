import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface NoteInput {
  path: string;
  title: string;
  content: string;
}

export interface Chunk {
  path: string;
  /** The `## section` heading this chunk came from (""=preamble). */
  heading: string;
  /** Embedded text: title + heading + section body. */
  text: string;
}

export interface EmbeddedChunk extends Chunk {
  hash: string;
  vector: number[];
}

export interface SemanticResult {
  path: string;
  heading: string;
  snippet: string;
  score: number;
}

/** Embeds a batch of texts into vectors. Injected so the index is testable. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

function hashText(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

/**
 * Split a note into section chunks (by `## ` heading). The note title is
 * prepended to every chunk so each is self-describing when retrieved. The H1
 * title line is dropped from bodies (already carried by `title`). Pure.
 */
export function chunkNote(
  notePath: string,
  title: string,
  content: string
): Chunk[] {
  const sections: Array<{ heading: string; bodyLines: string[] }> = [];
  let current = { heading: "", bodyLines: [] as string[] };

  for (const line of content.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      sections.push(current);
      current = { heading: m[1].trim(), bodyLines: [] };
    } else if (/^#\s/.test(line)) {
      continue; // drop the H1 title line; title is prepended explicitly
    } else {
      current.bodyLines.push(line);
    }
  }
  sections.push(current);

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const body = s.bodyLines.join("\n").trim();
    if (!body && !s.heading) continue;
    const text = [title, s.heading, body].filter(Boolean).join("\n").trim();
    if (!text) continue;
    chunks.push({ path: notePath, heading: s.heading, text });
  }
  return chunks;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * In-memory semantic index over section chunks. Embeddings are cached by
 * content hash (`.mcp/embeddings.json`) so rebuilds and edits only embed
 * genuinely new text. Cosine over a few thousand chunks is trivially fast;
 * no vector DB needed. Embedder is injected (real model in prod, fake in tests).
 */
export class EmbeddingIndex {
  private chunks: EmbeddedChunk[] = [];
  private cache = new Map<string, number[]>();
  private cachePath?: string;

  constructor(
    private embed: Embedder,
    options: { cachePath?: string } = {}
  ) {
    this.cachePath = options.cachePath;
  }

  async loadCache(): Promise<void> {
    if (!this.cachePath) return;
    try {
      const raw = await fs.readFile(this.cachePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, number[]>;
      this.cache = new Map(Object.entries(data));
    } catch {
      // no cache yet — fine
    }
  }

  async saveCache(): Promise<void> {
    if (!this.cachePath) return;
    // Persist only vectors still referenced by a live chunk (bounds growth).
    const obj: Record<string, number[]> = {};
    for (const c of this.chunks) obj[c.hash] = c.vector;
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    await fs.writeFile(this.cachePath, JSON.stringify(obj));
  }

  private async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    const out: EmbeddedChunk[] = [];
    const pending: Array<{ chunk: Chunk; hash: string }> = [];

    for (const chunk of chunks) {
      const hash = hashText(chunk.text);
      const cached = this.cache.get(hash);
      if (cached) {
        out.push({ ...chunk, hash, vector: cached });
      } else {
        pending.push({ chunk, hash });
      }
    }

    if (pending.length > 0) {
      const vectors = await this.embed(pending.map((p) => p.chunk.text));
      for (let i = 0; i < pending.length; i++) {
        const { chunk, hash } = pending[i];
        const vector = vectors[i];
        this.cache.set(hash, vector);
        out.push({ ...chunk, hash, vector });
      }
    }

    return out;
  }

  async buildFromVault(notes: NoteInput[]): Promise<void> {
    const all: Chunk[] = [];
    for (const n of notes) all.push(...chunkNote(n.path, n.title, n.content));
    this.chunks = await this.embedChunks(all);
  }

  async addOrUpdate(note: NoteInput): Promise<void> {
    this.chunks = this.chunks.filter((c) => c.path !== note.path);
    const embedded = await this.embedChunks(
      chunkNote(note.path, note.title, note.content)
    );
    this.chunks.push(...embedded);
  }

  remove(notePath: string): void {
    this.chunks = this.chunks.filter((c) => c.path !== notePath);
  }

  async search(query: string, limit = 8): Promise<SemanticResult[]> {
    if (this.chunks.length === 0) return [];
    const [qv] = await this.embed([query]);
    const scored = this.chunks.map((c) => ({ c, score: cosine(qv, c.vector) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ c, score }) => ({
      path: c.path,
      heading: c.heading,
      snippet: c.text.length > 320 ? c.text.slice(0, 320) + "…" : c.text,
      score,
    }));
  }

  get size(): number {
    return this.chunks.length;
  }
}
