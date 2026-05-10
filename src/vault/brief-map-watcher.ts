import { watch, type FSWatcher } from "chokidar";
import path from "node:path";
import { loadBriefMap } from "./brief-map-loader.js";
import { logger } from "../utils/logger.js";

export class BriefMapWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private vaultRoot: string,
    private onReload: (newMap: Record<string, string>) => void
  ) {}

  start(): void {
    const filePath = path.join(this.vaultRoot, ".mcp", "brief-map.json");

    this.watcher = watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on("change", () => this.handleChange());
    logger.info("Brief-map watcher started", { filePath });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }

  private handleChange(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      try {
        const newMap = await loadBriefMap(this.vaultRoot);
        this.onReload(newMap);
        logger.info("Brief map hot-reloaded", {
          entries: Object.keys(newMap).length,
        });
      } catch (err) {
        logger.warn("Failed to hot-reload brief map", {
          error: String(err),
        });
      }
    }, 200);
  }
}
