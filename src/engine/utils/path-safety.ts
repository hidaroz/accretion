import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

/**
 * Expand a leading `~` to the user's home directory.
 *
 * Shells expand `~` before a process ever sees it, so a path typed at a prompt
 * arrives already absolute — but one read from a config file or an env var does
 * not. `path.resolve("~/.config/x")` yields `<cwd>/~/.config/x`, which fails
 * with a confusing ENOENT naming a directory the user never wrote.
 *
 * Only a leading `~/` (or a bare `~`) is expanded. `~user` syntax is not
 * supported: resolving it needs the password database, and treating it as the
 * current user's home would silently point somewhere wrong.
 */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

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
