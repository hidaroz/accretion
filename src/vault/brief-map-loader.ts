import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

export async function loadBriefMap(
  vaultRoot: string
): Promise<Record<string, string>> {
  const filePath = path.join(vaultRoot, ".mcp", "brief-map.json");

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.warn("brief-map.json must be a flat object, ignoring", {
        vaultRoot,
      });
      return {};
    }

    logger.info(`Loaded brief map with ${Object.keys(parsed).length} entries`, {
      vaultRoot,
    });
    return parsed as Record<string, string>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    logger.warn("Failed to load brief-map.json", {
      vaultRoot,
      error: String(err),
    });
    return {};
  }
}
