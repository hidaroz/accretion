#!/usr/bin/env node

/**
 * Structural health of a knowledge-base vault as named lint rules
 * (orphan, missing-link, missing-page, stale-reference, missing-provenance), as JSON.
 *
 * Usage:
 *   node scripts/memory-garden.mjs [--vault demo] [--rules orphan,missing-link] [--threshold N]
 *
 * Requires `npm run build` (imports compiled dist/). Superseded by `accretion garden`.
 */

import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { runGarden } from "../dist/engine/lifecycle/garden.js";

const args = parseArgs(process.argv.slice(2));
const rules = typeof args.rules === "string" ? args.rules.split(",").map((s) => s.trim()) : undefined;

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const result = await runGarden(vaultRoot, {
    rules,
    threshold: args.threshold ? Number(args.threshold) : 3,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
