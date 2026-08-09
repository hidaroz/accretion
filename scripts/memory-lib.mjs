// Shared helpers for the memory-* CLI wrappers. Logic lives in the compiled
// TypeScript modules under dist/ — these scripts only resolve the vault root
// and print JSON.

import fs from "node:fs/promises";
import path from "node:path";

// Keep stdout pure JSON: the dist/ logger writes info-level lines to
// stdout. This module must stay the FIRST import in every memory-* script
// so the level is set before the logger module is evaluated.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const VAULTS_CONFIG =
  process.env.VAULTS_CONFIG ||
  path.join(process.env.HOME || "", ".config", "accretion", "vaults.json");

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
  return vault.path;
}

export function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
