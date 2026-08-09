import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { expandHome } from "../utils/path-safety.js";

export interface VaultConfig {
  id: string;
  path: string;
  displayName: string;
  default?: boolean;
  gitAutoCommit?: boolean;
  gitAutoPush?: boolean;
}

interface VaultsConfigFile {
  vaults: VaultConfig[];
}

export async function loadVaultsConfig(): Promise<VaultConfig[]> {
  const configPath = process.env.VAULTS_CONFIG;
  const legacyVaultPath = process.env.VAULT_PATH;

  if (configPath) {
    const resolved = path.resolve(expandHome(configPath));
    const raw = await fs.readFile(resolved, "utf-8");
    const parsed = JSON.parse(raw) as VaultsConfigFile;
    validate(parsed.vaults);
    // Vault paths are hand-editable, so they get the same treatment as the
    // registry path itself — a `~` in vaults.json is a typo waiting to happen.
    for (const v of parsed.vaults) v.path = path.resolve(expandHome(v.path));
    logger.info(`Loaded ${parsed.vaults.length} vault(s) from ${resolved}`);
    return parsed.vaults;
  }

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
    "No vault configuration found. Set VAULTS_CONFIG (path to JSON config file) or VAULT_PATH (single vault)."
  );
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
    if (!path.isAbsolute(v.path)) {
      throw new Error(
        `Vault "${v.id}" path must be absolute, got: ${v.path}`
      );
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
