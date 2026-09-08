// Shared helpers for the memory-* CLI wrappers. Logic lives in the compiled
// TypeScript modules under dist/; these scripts only resolve the vault root
// and print JSON. They are replaced by `accretion <subcommand>`; see ADR-001.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { expandHome } from "./lib/expand-home.mjs";

// Keep stdout pure JSON: the dist/ logger writes info-level lines to
// stdout. This module must stay the FIRST import in every memory-* script
// so the level is set before the logger module is evaluated.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

// os.homedir() rather than process.env.HOME: under launchd and in containers
// HOME is often unset, and joining from "" yields a *relative* path that
// resolves against whatever cwd the caller happened to have.
const CONFIG_PATH = path.join(os.homedir(), ".config", "accretion", "vaults.json");
const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".config", "obsidian-mcp", "vaults.json");

function resolveConfigPath() {
  if (process.env.VAULTS_CONFIG) return expandHome(process.env.VAULTS_CONFIG);
  if (existsSync(CONFIG_PATH)) return CONFIG_PATH;
  if (existsSync(LEGACY_CONFIG_PATH)) {
    console.error(`[accretion] reading legacy registry ${LEGACY_CONFIG_PATH}; move it to ${CONFIG_PATH}`);
    return LEGACY_CONFIG_PATH;
  }
  return CONFIG_PATH;
}

const VAULTS_CONFIG = resolveConfigPath();

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function resolveVaultRoot(vaultId) {
  const raw = await fs.readFile(VAULTS_CONFIG, "utf-8");
  const config = JSON.parse(raw);
  const vaults = config.vaults || [];

  const vault = vaultId
    ? vaults.find((v) => v.id === vaultId)
    : (vaults.find((v) => v.default) ?? vaults[0]);

  if (!vault) {
    throw new Error(
      vaultId
        ? `Vault '${vaultId}' not found in ${VAULTS_CONFIG}`
        : `No vaults configured in ${VAULTS_CONFIG}`
    );
  }
  // Relative to the registry file, matching the engine.
  return path.resolve(path.dirname(VAULTS_CONFIG), expandHome(vault.path));
}

export function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
