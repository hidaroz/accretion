import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { expandHome } from "../utils/path-safety.js";
import type { RecallMode } from "../context/recall.js";

export interface VaultConfig {
  id: string;
  path: string;
  displayName: string;
  default?: boolean;
  /** Read by `accretion commit`; the engine itself never runs git. */
  gitAutoCommit?: boolean;
  gitAutoPush?: boolean;
  /** "auto" (default) turns embeddings on once the curated layer is big enough. */
  semantic?: "auto" | boolean;
  /** Curated-note count at which "auto" enables embeddings (default 300). */
  semanticThreshold?: number;
  /** Where the engine may write. Defaults to DEFAULT_WRITABLE_PATHS. */
  writablePaths?: string[];
  /** Passive-recall hook settings. */
  recall?: { budget?: number; mode?: RecallMode; /** Embeddings in the hook (default false: latency). */ semantic?: boolean };
}

interface VaultsConfigFile {
  vaults: VaultConfig[];
}

/**
 * Raw sessions, their digests, proposals and the event log. Hand-authored
 * notes stay out unless a caller passes `unrestricted`, which only proposal
 * application does.
 */
export const DEFAULT_WRITABLE_PATHS = [
  "sessions/",
  "proposals/",
  "00-Index/log.md",
  "00-Index/index.md",
];

export const DEFAULT_SEMANTIC_THRESHOLD = 300;

export const CONFIG_PATH = path.join(os.homedir(), ".config", "accretion", "vaults.json");
/** Pre-rename location; read with a deprecation warning until migrated. */
export const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".config", "obsidian-mcp", "vaults.json");

/**
 * VAULTS_CONFIG wins. Otherwise the accretion path, then the legacy path.
 * Returns null when nothing exists so callers can fall back to VAULT_PATH.
 */
export function resolveVaultsConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.VAULTS_CONFIG) return path.resolve(expandHome(env.VAULTS_CONFIG));
  if (existsSync(CONFIG_PATH)) return CONFIG_PATH;
  if (existsSync(LEGACY_CONFIG_PATH)) {
    logger.warn(
      `Reading legacy registry ${LEGACY_CONFIG_PATH}; move it to ${CONFIG_PATH} (accretion doctor offers this).`
    );
    return LEGACY_CONFIG_PATH;
  }
  return null;
}

/** Whether embeddings should be on for a vault of this size. */
export function resolveSemantic(
  cfg: Pick<VaultConfig, "semantic" | "semanticThreshold">,
  curatedCount: number,
  envDisabled: boolean = !!process.env.DISABLE_EMBEDDINGS
): boolean {
  if (envDisabled) return false;
  const mode = cfg.semantic ?? "auto";
  if (mode === true || mode === false) return mode;
  return curatedCount >= (cfg.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD);
}

export async function loadVaultsConfigFrom(configPath: string): Promise<VaultConfig[]> {
  const resolved = path.resolve(expandHome(configPath));
  const raw = await fs.readFile(resolved, "utf-8");
  const parsed = JSON.parse(raw) as VaultsConfigFile;
  validate(parsed.vaults);
  // Vault paths are hand-editable, so they get the same treatment as the
  // registry path itself: a `~` in vaults.json is a typo waiting to happen.
  // Relative paths resolve against the working directory, which is how the
  // checked-in CI registry addresses demo-vault/.
  for (const v of parsed.vaults) v.path = path.resolve(expandHome(v.path));
  logger.info(`Loaded ${parsed.vaults.length} vault(s) from ${resolved}`);
  return parsed.vaults;
}

export async function loadVaultsConfig(): Promise<VaultConfig[]> {
  const configPath = resolveVaultsConfigPath();
  if (configPath) return loadVaultsConfigFrom(configPath);

  const legacyVaultPath = process.env.VAULT_PATH;
  if (legacyVaultPath) {
    const abs = path.resolve(expandHome(legacyVaultPath));
    logger.info(`Single-vault mode: ${abs}`);
    return [
      {
        id: "default",
        path: abs,
        displayName: "Default Vault",
        default: true,
      },
    ];
  }

  throw new Error(
    `No vault configuration found. Set VAULTS_CONFIG, create ${CONFIG_PATH} (accretion setup-vault), or set VAULT_PATH for a single vault.`
  );
}

/** Pick a vault by id, else the default, else the first. */
export function selectVault(vaults: VaultConfig[], vaultId?: string): VaultConfig {
  if (vaultId) {
    const v = vaults.find((x) => x.id === vaultId);
    if (!v) throw new Error(`Unknown vault: "${vaultId}". Known: ${vaults.map((x) => x.id).join(", ")}`);
    return v;
  }
  return vaults.find((v) => v.default) ?? vaults[0];
}

function validate(vaults: VaultConfig[]): void {
  if (!Array.isArray(vaults) || vaults.length === 0) {
    throw new Error("vaults config must contain at least one vault entry");
  }

  const ids = new Set<string>();
  let defaultCount = 0;

  for (const v of vaults) {
    if (!v.id || typeof v.id !== "string") {
      throw new Error(`Vault entry missing 'id'`);
    }
    if (!v.path || typeof v.path !== "string") {
      throw new Error(`Vault "${v.id}" missing 'path'`);
    }
    if (!v.displayName || typeof v.displayName !== "string") {
      throw new Error(`Vault "${v.id}" missing 'displayName'`);
    }
    if (ids.has(v.id)) {
      throw new Error(`Duplicate vault id: "${v.id}"`);
    }
    ids.add(v.id);
    if (v.default) defaultCount++;
  }

  if (defaultCount > 1) {
    throw new Error("At most one vault may be marked as default");
  }
}
