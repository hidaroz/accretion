import path from "node:path";
import fs from "node:fs/promises";

// Cache resolved vault root paths — vault root never changes at runtime
const realPathCache = new Map<string, string>();

async function getCachedRealPath(dir: string): Promise<string> {
  const cached = realPathCache.get(dir);
  if (cached) return cached;

  const resolved = await fs.realpath(dir);
  realPathCache.set(dir, resolved);
  return resolved;
}

/**
 * Resolves a relative vault path and ensures it stays within the vault root.
 * Rejects path traversal attempts (..), absolute paths, and symlinks escaping the vault.
 */
export async function resolveSafePath(
  vaultRoot: string,
  relativePath: string
): Promise<string> {
  // Reject absolute paths
  if (path.isAbsolute(relativePath)) {
    throw new PathSafetyError(`Absolute paths are not allowed: ${relativePath}`);
  }

  // Reject explicit traversal
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes(`${path.sep}..`)) {
    throw new PathSafetyError(
      `Path traversal is not allowed: ${relativePath}`
    );
  }

  const resolved = path.resolve(vaultRoot, normalized);

  // Ensure resolved path is within vault root (cached)
  const realVaultRoot = await getCachedRealPath(vaultRoot);
  if (!resolved.startsWith(realVaultRoot + path.sep) && resolved !== realVaultRoot) {
    throw new PathSafetyError(
      `Path escapes vault root: ${relativePath}`
    );
  }

  // If file exists, check that symlinks don't escape
  try {
    const realResolved = await fs.realpath(resolved);
    if (
      !realResolved.startsWith(realVaultRoot + path.sep) &&
      realResolved !== realVaultRoot
    ) {
      throw new PathSafetyError(
        `Symlink escapes vault root: ${relativePath}`
      );
    }
  } catch (err: unknown) {
    // File doesn't exist yet — that's fine for create operations
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return resolved;
}

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}
