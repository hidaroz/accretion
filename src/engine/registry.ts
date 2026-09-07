import path from "node:path";
import { VaultManager } from "./vault/vault-manager.js";
import { SearchIndex } from "./retrieval/search-index.js";
import { TagIndex } from "./vault/tag-index.js";
import { VaultWatcher } from "./vault/watcher.js";
import { BriefMapWatcher } from "./retrieval/brief-map-watcher.js";
import { SearchAnalytics } from "./retrieval/search-analytics.js";
import { loadBriefMap } from "./retrieval/brief-map-loader.js";
import { EmbeddingIndex, type Embedder } from "./retrieval/embedding-index.js";
import { createLocalEmbedder } from "./retrieval/embedder.js";
import type { VaultConfig } from "./config/vault-config.js";
import { VaultNotFoundError, VaultNotReadyError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

export interface VaultContext {
  id: string;
  displayName: string;
  vault: VaultManager;
  searchIndex: SearchIndex;
  tagIndex: TagIndex;
  embeddingIndex?: EmbeddingIndex;
  watcher: VaultWatcher;
  briefMapWatcher: BriefMapWatcher;
  analytics: SearchAnalytics;
  briefMap: Record<string, string>;
  ready: boolean;
  initError: string | null;
}

export class VaultRegistry {
  private contexts = new Map<string, VaultContext>();
  private defaultVaultId: string;
  /** Shared across vaults so the embedding model loads at most once. Null when
   *  embeddings are disabled (DISABLE_EMBEDDINGS) — semantic search no-ops. */
  private embedder: Embedder | null;

  constructor(private configs: VaultConfig[]) {
    const explicit = configs.find((c) => c.default);
    this.defaultVaultId = explicit?.id ?? configs[0].id;
    this.embedder = process.env.DISABLE_EMBEDDINGS
      ? null
      : createLocalEmbedder();
  }

  async initializeAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.configs.map((cfg) => this.initializeVault(cfg))
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        const cfg = this.configs[i];
        const reason = (results[i] as PromiseRejectedResult).reason;
        logger.error(`Failed to initialize vault "${cfg.id}"`, {
          error: String(reason),
        });
      }
    }
  }

  resolve(vaultId?: string): VaultContext {
    const id = vaultId || this.defaultVaultId;
    const ctx = this.contexts.get(id);

    if (!ctx) {
      throw new VaultNotFoundError(id);
    }
    if (!ctx.ready) {
      throw new VaultNotReadyError(id);
    }

    return ctx;
  }

  list(): VaultContext[] {
    return Array.from(this.contexts.values());
  }

  get allReady(): boolean {
    if (this.contexts.size === 0) return false;
    for (const ctx of this.contexts.values()) {
      if (!ctx.ready) return false;
    }
    return true;
  }

  get defaultId(): string {
    return this.defaultVaultId;
  }

  async shutdown(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      ctx.briefMapWatcher.stop();
      ctx.watcher.stop();
    }
  }

  private async initializeVault(cfg: VaultConfig): Promise<void> {
    const vault = new VaultManager(cfg.path, {
      gitAutoCommit: cfg.gitAutoCommit,
      gitAutoPush: cfg.gitAutoPush,
    });
    const searchIndex = new SearchIndex();
    const tagIndex = new TagIndex();
    const embeddingIndex = this.embedder
      ? new EmbeddingIndex(this.embedder, {
          cachePath: path.join(cfg.path, ".mcp", "embeddings.json"),
        })
      : undefined;
    const watcher = new VaultWatcher(vault, searchIndex, tagIndex, embeddingIndex);
    const briefMap = await loadBriefMap(cfg.path);
    const analytics = new SearchAnalytics(cfg.path);

    const briefMapWatcher = new BriefMapWatcher(cfg.path, (newMap) => {
      ctx.briefMap = newMap;
    });

    const ctx: VaultContext = {
      id: cfg.id,
      displayName: cfg.displayName,
      vault,
      searchIndex,
      tagIndex,
      embeddingIndex,
      watcher,
      briefMapWatcher,
      analytics,
      briefMap,
      ready: false,
      initError: null,
    };

    this.contexts.set(cfg.id, ctx);

    try {
      const start = Date.now();
      const allNotes = await vault.getAllNotes();
      logger.info(`Vault "${cfg.id}": loaded ${allNotes.length} notes in ${Date.now() - start}ms`);

      await searchIndex.buildFromVault(vault, allNotes);
      await tagIndex.buildFromVault(vault, allNotes);
      watcher.start();
      briefMapWatcher.start();

      ctx.ready = true;
      logger.info(`Vault "${cfg.id}" initialized in ${Date.now() - start}ms`);

      // Build the semantic index in the background — the model load / first
      // embed can be slow and must never block readiness or keyword search.
      // The on-disk cache makes subsequent boots fast; failure (e.g. no model
      // access) is logged and leaves semantic_search returning nothing.
      if (embeddingIndex) {
        void (async () => {
          try {
            const t0 = Date.now();
            await embeddingIndex.loadCache();
            await embeddingIndex.buildFromVault(allNotes);
            await embeddingIndex.saveCache();
            logger.info(
              `Vault "${cfg.id}": embedded ${embeddingIndex.size} chunks in ${Date.now() - t0}ms`
            );
          } catch (err) {
            logger.warn(`Vault "${cfg.id}": embedding index build failed`, {
              error: String(err),
            });
          }
        })();
      }
    } catch (err) {
      ctx.initError = String(err);
      throw err;
    }
  }
}
