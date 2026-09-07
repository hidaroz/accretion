#!/usr/bin/env node

/**
 * Print the spaced-review queue for a vault, as JSON: evergreen notes
 * (type/note) past the review window, most overdue first.
 *
 * Usage:
 *   node scripts/memory-resurface.mjs [--vault general] [--window 14]
 *
 * Requires `npm run build` (imports compiled dist/).
 */

import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { findResurfaceCandidates } from "../dist/engine/lifecycle/resurface-review.js";

const args = parseArgs(process.argv.slice(2));

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const result = await findResurfaceCandidates(vaultRoot, {
    window: args.window ? Number(args.window) : 14,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
