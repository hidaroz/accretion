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
import {
  DEFAULT_WRITABLE_PATHS,
  resolveSemantic,
  type VaultConfig,
} from "./config/vault-config.js";
import { VaultNotFoundError, VaultNotReadyError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

export interface VaultContext {
  id: string;
  displayName: string;
  config: VaultConfig;
  vault: VaultManager;
  searchIndex: SearchIndex;
  tagIndex: TagIndex;
  embeddingIndex?: EmbeddingIndex;
  /** Whether embeddings were enabled for this vault (config + size + env). */
  semantic: boolean;
  watcher: VaultWatcher;
  briefMapWatcher: BriefMapWatcher;
  analytics: SearchAnalytics;
  /** Explicit `.mcp/brief-map.json` entries only. */
  fileBriefMap: Record<string, string>;
  /** Effective routing map: frontmatter keywords overridden by the file map. */
  briefMap: Record<string, string>;
  ready: boolean;
  initError: string | null;
}

/**
 * Long-lived registry for the MCP adapter: one context per vault, kept live
 * by file watchers. One-shot callers (CLI, hooks) use `openVault` instead.
 */
export class VaultRegistry {
  private contexts = new Map<string, VaultContext>();
  private defaultVaultId: string;
  /** Shared across vaults so the embedding model loads at most once. Created
   *  lazily: a registry of small vaults never pays for it. */
  private embedder: Embedder | null = null;

  constructor(private configs: VaultConfig[]) {
    const explicit = configs.find((c) => c.default);
    this.defaultVaultId = explicit?.id ?? configs[0].id;
  }

  private getEmbedder(): Embedder {
    if (!this.embedder) this.embedder = createLocalEmbedder();
    return this.embedder;
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
      writablePaths: cfg.writablePaths ?? DEFAULT_WRITABLE_PATHS,
    });
    const searchIndex = new SearchIndex();
    const tagIndex = new TagIndex();
    const fileBriefMap = await loadBriefMap(cfg.path);
    const analytics = new SearchAnalytics(cfg.path);

    const refreshBriefMap = () => {
      ctx.briefMap = searchIndex.briefMap(ctx.fileBriefMap);
    };

    const briefMapWatcher = new BriefMapWatcher(cfg.path, (newMap) => {
      ctx.fileBriefMap = newMap;
      refreshBriefMap();
    });

    const ctx: VaultContext = {
      id: cfg.id,
      displayName: cfg.displayName,
      config: cfg,
      vault,
      searchIndex,
      tagIndex,
      embeddingIndex: undefined,
      semantic: false,
      watcher: undefined as unknown as VaultWatcher,
      briefMapWatcher,
      analytics,
      fileBriefMap,
      briefMap: fileBriefMap,
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
      refreshBriefMap();

      ctx.semantic = resolveSemantic(cfg, searchIndex.curatedCount);
      const embeddingIndex = ctx.semantic
        ? new EmbeddingIndex(this.getEmbedder(), {
            cachePath: path.join(cfg.path, ".mcp", "embeddings.json"),
          })
        : undefined;
      ctx.embeddingIndex = embeddingIndex;

      ctx.watcher = new VaultWatcher(vault, searchIndex, tagIndex, embeddingIndex, {
        onNote: refreshBriefMap,
        onRemove: refreshBriefMap,
      });
      ctx.watcher.start();
      briefMapWatcher.start();

      ctx.ready = true;
      logger.info(
        `Vault "${cfg.id}" initialized in ${Date.now() - start}ms (semantic: ${ctx.semantic ? "on" : "off"}, routing keywords: ${Object.keys(ctx.briefMap).length})`
      );

      // Build the semantic index in the background: the model load / first
      // embed can be slow and must never block readiness or keyword search.
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
