import { watch, type FSWatcher } from "chokidar";
import path from "node:path";
import { VaultManager, type NoteContent } from "./vault-manager.js";
import { SearchIndex } from "../retrieval/search-index.js";
import { TagIndex } from "./tag-index.js";
import type { EmbeddingIndex } from "../retrieval/embedding-index.js";
import { logger } from "../utils/logger.js";

export interface VaultWatcherHooks {
  /** Called after a note has been (re)indexed. */
  onNote?: (note: NoteContent) => void;
  /** Called after a note has been removed from the indexes. */
  onRemove?: (relativePath: string) => void;
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private vault: VaultManager,
    private searchIndex: SearchIndex,
    private tagIndex: TagIndex,
    private embeddingIndex?: EmbeddingIndex,
    private hooks: VaultWatcherHooks = {}
  ) {}

  start(): void {
    const vaultPath = this.vault.root;

    this.watcher = watch(vaultPath, {
      ignored: [
        /(^|[/\\])\./,       // Hidden files/folders (.obsidian, .git)
        /node_modules/,
        /sessions\/archive/, // Archived sessions excluded from live index
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher
      .on("add", (filePath) => this.handleChange(filePath))
      .on("change", (filePath) => this.handleChange(filePath))
      .on("unlink", (filePath) => this.handleDelete(filePath));

    logger.info("Vault watcher started", { vaultPath });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info("Vault watcher stopped");
    }
  }

  private handleChange(filePath: string): void {
    if (!filePath.endsWith(".md")) return;

    // Debounce rapid changes (e.g., during git pull)
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      filePath,
      setTimeout(async () => {
        this.debounceTimers.delete(filePath);

        const relativePath = path.relative(this.vault.root, filePath);
        try {
          const note = await this.vault.read(relativePath);
          this.searchIndex.addOrUpdate(note);
          this.tagIndex.addNote(note.path, note.tags);
          if (this.embeddingIndex) {
            await this.embeddingIndex.addOrUpdate(note);
          }
          this.hooks.onNote?.(note);
          logger.debug("Index updated for note", { path: relativePath });
        } catch (err) {
          logger.warn("Failed to index note", {
            path: relativePath,
            error: String(err),
          });
        }
      }, 100)
    );
  }

  private handleDelete(filePath: string): void {
    if (!filePath.endsWith(".md")) return;

    const relativePath = path.relative(this.vault.root, filePath);
    this.searchIndex.remove(relativePath);
    this.tagIndex.removeNote(relativePath);
    this.embeddingIndex?.remove(relativePath);
    this.hooks.onRemove?.(relativePath);
    logger.debug("Removed from index", { path: relativePath });
  }
}
