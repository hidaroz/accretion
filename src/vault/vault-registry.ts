import { VaultManager } from "./vault-manager.js";
import { SearchIndex } from "./search-index.js";
import { TagIndex } from "./tag-index.js";
import { VaultWatcher } from "./watcher.js";
import { BriefMapWatcher } from "./brief-map-watcher.js";
import { SearchAnalytics } from "./search-analytics.js";
import { loadBriefMap } from "./brief-map-loader.js";
import type { VaultConfig } from "./vault-config.js";
import { VaultNotFoundError, VaultNotReadyError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface VaultContext {
  id: string;
  displayName: string;
  vault: VaultManager;
  searchIndex: SearchIndex;
  tagIndex: TagIndex;
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

  constructor(private configs: VaultConfig[]) {
    const explicit = configs.find((c) => c.default);
    this.defaultVaultId = explicit?.id ?? configs[0].id;
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
    const watcher = new VaultWatcher(vault, searchIndex, tagIndex);
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
    } catch (err) {
      ctx.initError = String(err);
      throw err;
    }
  }
}
