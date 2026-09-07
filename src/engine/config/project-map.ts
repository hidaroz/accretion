// Which vault a working directory's sessions belong to. The map is keyed by the
// directory basename ("slug") and is opt-in: an unmapped slug with `_default`
// null records nothing. Both hooks read it; nothing else does.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome } from "../utils/path-safety.js";

export type ProjectMap = Record<string, string | null>;

export const PROJECT_MAP_PATH = path.join(os.homedir(), ".config", "accretion", "project-map.json");
/** Where bootstrap has always written it; still honoured. */
export const LEGACY_PROJECT_MAP_PATH = path.join(os.homedir(), ".claude", "hooks", "project-vault-map.json");

/** PROJECT_VAULT_MAP wins; then the accretion path; then the legacy hooks path. */
export function resolveProjectMapPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PROJECT_VAULT_MAP) return path.resolve(expandHome(env.PROJECT_VAULT_MAP));
  if (fs.existsSync(PROJECT_MAP_PATH)) return PROJECT_MAP_PATH;
  return LEGACY_PROJECT_MAP_PATH;
}

/** Sync on purpose: the capture hook runs under a 1.5 s shared budget. Fails closed. */
export function loadProjectMap(mapPath: string): ProjectMap | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ProjectMap) : null;
  } catch {
    return null;
  }
}

/**
 * Vault id for a project slug, or null when capture is not opted in. A missing
 * or unparseable map is null too: not recording a session costs one note,
 * recording it into the wrong vault costs someone their shell history.
 */
export function resolveVaultForSlug(slug: string, map: ProjectMap | null): string | null {
  if (!map) return null;
  const direct = map[slug];
  if (typeof direct === "string" && direct) return direct;
  const fallback = map._default;
  return typeof fallback === "string" && fallback ? fallback : null;
}

export function slugForCwd(cwd: string | undefined): string {
  return cwd ? path.basename(cwd) : "unknown";
}
