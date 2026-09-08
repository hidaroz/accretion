import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { resolveSafePath, PathSafetyError } from "../utils/path-safety.js";
import { parseNote, stringifyNote, extractTitle, extractTags, type ParsedNote } from "./frontmatter.js";
import { NoteNotFoundError, NoteAlreadyExistsError, WriteNotAllowedError } from "../utils/errors.js";

export interface NoteInfo {
  path: string;
  title: string;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  size: number;
}

export interface NoteContent extends NoteInfo {
  frontmatter: Record<string, unknown>;
  content: string;
}


export interface VaultManagerOptions {
  /**
   * Paths the engine may write to. Entries are vault-relative; a trailing "/"
   * (or a bare directory name) allows everything beneath it, otherwise the
   * entry names one file. Undefined = unrestricted (tests, one-off scripts).
   * Hand-authored notes outside the list change only through an explicit
   * `unrestricted` write, which `applyProposal` is the one caller of.
   */
  writablePaths?: string[];
}

export interface WriteOptions {
  /** Bypass the allowlist. Reserved for proposal application. */
  unrestricted?: boolean;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Pure: is `relativePath` covered by the allowlist? */
export function isWritable(relativePath: string, writablePaths: string[] | undefined): boolean {
  if (!writablePaths) return true;
  const rel = normalizeRel(relativePath);
  for (const raw of writablePaths) {
    const entry = normalizeRel(raw);
    if (!entry) continue;
    if (entry.endsWith("/")) {
      if (rel.startsWith(entry)) return true;
    } else if (rel === entry || rel.startsWith(entry + "/")) {
      return true;
    }
  }
  return false;
}

export class VaultManager {
  private options: VaultManagerOptions;

  private vaultRoot: string;

  constructor(vaultRoot: string, options?: VaultManagerOptions) {
    // Path safety compares real paths, so a vault reached through a symlink
    // (macOS /var → /private/var, a Documents folder linked elsewhere) would
    // otherwise reject every note and index nothing, silently.
    try {
      this.vaultRoot = realpathSync(vaultRoot);
    } catch {
      this.vaultRoot = vaultRoot;
    }
    this.options = options ?? {};
  }

  get root(): string {
    return this.vaultRoot;
  }

  get writablePaths(): string[] | undefined {
    return this.options.writablePaths;
  }

  private assertWritable(relativePath: string, opts?: WriteOptions): void {
    if (opts?.unrestricted) return;
    if (!isWritable(relativePath, this.options.writablePaths)) {
      throw new WriteNotAllowedError(relativePath, this.options.writablePaths ?? []);
    }
  }

  async read(relativePath: string): Promise<NoteContent> {
    const absPath = await resolveSafePath(this.vaultRoot, relativePath);
    let raw: string;
    try {
      raw = await fs.readFile(absPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NoteNotFoundError(relativePath);
      }
      throw err;
    }
    const stat = await fs.stat(absPath);
    const { frontmatter, content } = parseNote(raw);

    return {
      path: relativePath,
      title: extractTitle(frontmatter, content, relativePath),
      tags: extractTags(frontmatter, content),
      createdAt:
        typeof frontmatter.created === "string"
          ? new Date(frontmatter.created).toISOString()
          : stat.mtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size,
      frontmatter,
      content,
    };
  }

  async create(
    relativePath: string,
    content: string,
    frontmatter: Record<string, unknown> = {},
    opts?: WriteOptions
  ): Promise<NoteInfo> {
    if (!relativePath.endsWith(".md")) {
      relativePath += ".md";
    }
    this.assertWritable(relativePath, opts);

    const absPath = await resolveSafePath(this.vaultRoot, relativePath);

    // Reject if file already exists
    try {
      await fs.access(absPath);
      throw new NoteAlreadyExistsError(relativePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    await fs.mkdir(path.dirname(absPath), { recursive: true });

    const raw = stringifyNote(content, frontmatter);
    await fs.writeFile(absPath, raw, "utf-8");

    const stat = await fs.stat(absPath);
    return {
      path: relativePath,
      title: extractTitle(frontmatter, content, relativePath),
      tags: extractTags(frontmatter, content),
      createdAt:
        typeof frontmatter.created === "string"
          ? new Date(frontmatter.created).toISOString()
          : stat.mtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size,
    };
  }

  async update(
    relativePath: string,
    options: {
      content?: string;
      append?: string;
      prepend?: string;
      frontmatter?: Record<string, unknown>;
      mode?: "replace" | "append" | "prepend";
    } & WriteOptions
  ): Promise<NoteContent> {
    this.assertWritable(relativePath, options);
    const absPath = await resolveSafePath(this.vaultRoot, relativePath);
    const existing = await this.read(relativePath);

    let newContent = existing.content;
    const mode = options.mode || "replace";

    if (options.content !== undefined) {
      switch (mode) {
        case "replace":
          newContent = options.content;
          break;
        case "append":
          newContent = existing.content + "\n\n" + options.content;
          break;
        case "prepend":
          newContent = options.content + "\n\n" + existing.content;
          break;
      }
    } else if (options.append) {
      newContent = existing.content + "\n\n" + options.append;
    } else if (options.prepend) {
      newContent = options.prepend + "\n\n" + existing.content;
    }

    const newFrontmatter = options.frontmatter
      ? { ...existing.frontmatter, ...options.frontmatter }
      : existing.frontmatter;

    const raw = stringifyNote(newContent, newFrontmatter);
    await fs.writeFile(absPath, raw, "utf-8");

    return this.read(relativePath);
  }





  async getAllNotes(): Promise<NoteContent[]> {
    const notes: NoteContent[] = [];
    await this.walkDirFull(this.vaultRoot, notes);
    return notes;
  }

  // --- Private helpers ---


  private async walkDirFull(
    dir: string,
    results: NoteContent[]
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);

      // Archived sessions leave the live index; they stay on disk for grep and git.
      if (entry.isDirectory() && path.relative(this.vaultRoot, fullPath) === "sessions/archive") continue;

      if (entry.isDirectory()) {
        await this.walkDirFull(fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const relativePath = path.relative(this.vaultRoot, fullPath);
        try {
          const note = await this.read(relativePath);
          results.push(note);
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

}


export { PathSafetyError };
export type { ParsedNote };
