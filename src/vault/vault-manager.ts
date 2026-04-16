import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolveSafePath, PathSafetyError } from "../utils/path-safety.js";
import { parseNote, stringifyNote, extractTitle, extractTags, type ParsedNote } from "./frontmatter.js";
import { logger } from "../utils/logger.js";
import {
  NoteNotFoundError,
  NoteAlreadyExistsError,
  PatchStringNotFoundError,
  PatchStringAmbiguousError,
} from "../utils/errors.js";

const execFile = promisify(execFileCb);

export interface NoteInfo {
  path: string;
  title: string;
  tags: string[];
  modifiedAt: string;
  size: number;
}

export interface NoteContent extends NoteInfo {
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface FolderTree {
  name: string;
  type: "folder" | "file";
  children?: FolderTree[];
}

export class VaultManager {
  constructor(private vaultRoot: string) {}

  get root(): string {
    return this.vaultRoot;
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
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size,
      frontmatter,
      content,
    };
  }

  async create(
    relativePath: string,
    content: string,
    frontmatter: Record<string, unknown> = {}
  ): Promise<NoteInfo> {
    if (!relativePath.endsWith(".md")) {
      relativePath += ".md";
    }

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

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(absPath), { recursive: true });

    const raw = stringifyNote(content, frontmatter);
    await fs.writeFile(absPath, raw, "utf-8");

    // Fire-and-forget git commit
    this.gitCommit(`MCP: created ${relativePath}`);

    const stat = await fs.stat(absPath);
    return {
      path: relativePath,
      title: extractTitle(frontmatter, content, relativePath),
      tags: extractTags(frontmatter, content),
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
    }
  ): Promise<NoteContent> {
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

    // Fire-and-forget git commit
    this.gitCommit(`MCP: updated ${relativePath}`);

    return this.read(relativePath);
  }

  async patch(
    relativePath: string,
    edits: Array<{
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    }>
  ): Promise<NoteContent> {
    const absPath = await resolveSafePath(this.vaultRoot, relativePath);
    const existing = await this.read(relativePath);

    let content = existing.content;

    for (let i = 0; i < edits.length; i++) {
      const { old_string, new_string, replace_all } = edits[i];
      const count = countOccurrences(content, old_string);

      if (count === 0) {
        throw new PatchStringNotFoundError(relativePath, i, old_string);
      }
      if (count > 1 && !replace_all) {
        throw new PatchStringAmbiguousError(relativePath, i, count);
      }

      content = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);
    }

    const raw = stringifyNote(content, existing.frontmatter);
    await fs.writeFile(absPath, raw, "utf-8");

    this.gitCommit(`MCP: patched ${relativePath} (${edits.length} edits)`);

    return this.read(relativePath);
  }

  async delete(relativePath: string): Promise<void> {
    const absPath = await resolveSafePath(this.vaultRoot, relativePath);

    // Verify file exists
    await fs.access(absPath);
    await fs.unlink(absPath);

    // Clean up empty parent directories
    let dir = path.dirname(absPath);
    while (dir !== this.vaultRoot) {
      const entries = await fs.readdir(dir);
      if (entries.length === 0) {
        await fs.rmdir(dir);
        dir = path.dirname(dir);
      } else {
        break;
      }
    }

    // Fire-and-forget git commit
    this.gitCommit(`MCP: deleted ${relativePath}`);
  }

  async list(
    folder: string = "",
    recursive: boolean = false,
    limit: number = 100
  ): Promise<NoteInfo[]> {
    const absFolder = folder
      ? await resolveSafePath(this.vaultRoot, folder)
      : this.vaultRoot;

    const notes: NoteInfo[] = [];
    await this.walkDir(absFolder, recursive, notes, limit);

    // Sort by modified date descending
    notes.sort(
      (a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );

    return notes.slice(0, limit);
  }

  async getFolderTree(folder: string = ""): Promise<FolderTree> {
    const absFolder = folder
      ? await resolveSafePath(this.vaultRoot, folder)
      : this.vaultRoot;

    return this.buildTree(absFolder, path.basename(absFolder));
  }

  async getAllNotes(): Promise<NoteContent[]> {
    const notes: NoteContent[] = [];
    await this.walkDirFull(this.vaultRoot, notes);
    return notes;
  }

  // --- Private helpers ---

  private async walkDir(
    dir: string,
    recursive: boolean,
    results: NoteInfo[],
    limit: number
  ): Promise<void> {
    if (results.length >= limit) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= limit) return;

      // Skip hidden files/folders (.obsidian, .git, etc.)
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && recursive) {
        await this.walkDir(fullPath, recursive, results, limit);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const relativePath = path.relative(this.vaultRoot, fullPath);
        try {
          const stat = await fs.stat(fullPath);
          const raw = await fs.readFile(fullPath, "utf-8");
          const { frontmatter, content } = parseNote(raw);

          results.push({
            path: relativePath,
            title: extractTitle(frontmatter, content, relativePath),
            tags: extractTags(frontmatter, content),
            modifiedAt: stat.mtime.toISOString(),
            size: stat.size,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  private async walkDirFull(
    dir: string,
    results: NoteContent[]
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);

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

  private async buildTree(dir: string, name: string): Promise<FolderTree> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const children: FolderTree[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        children.push(await this.buildTree(fullPath, entry.name));
      } else if (entry.name.endsWith(".md")) {
        children.push({ name: entry.name, type: "file" });
      }
    }

    return { name, type: "folder", children };
  }

  private gitCommit(message: string): void {
    const cwd = this.vaultRoot;

    // Stage → commit → push as separate steps to avoid shell injection
    execFile("git", ["add", "-A"], { cwd })
      .then(() =>
        // Check if there are staged changes before committing
        execFile("git", ["diff", "--cached", "--quiet"], { cwd }).catch(() =>
          // Non-zero exit means there are staged changes — commit them
          execFile("git", ["commit", "-m", message], { cwd })
        )
      )
      .then(() =>
        execFile("git", ["push"], { cwd }).catch((pushErr) => {
          logger.error("Git push failed", {
            message,
            error: String(pushErr),
          });
        })
      )
      .catch((err) => {
        logger.error("Git commit failed", {
          message,
          error: String(err),
        });
      });
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export { PathSafetyError };
