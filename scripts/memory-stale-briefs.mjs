#!/usr/bin/env node

/**
 * Print briefs that are stale (not reviewed in N days) AND have related
 * session activity since their review date, as JSON.
 *
 * Usage:
 *   node scripts/memory-stale-briefs.mjs [--vault demo] [--stale-days 21]
 *
 * Requires `npm run build` (imports compiled dist/).
 */

import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { getStaleBriefs } from "../dist/vault/brief-staleness.js";

const args = parseArgs(process.argv.slice(2));

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const result = await getStaleBriefs(vaultRoot, {
    staleDays: args["stale-days"] ? Number(args["stale-days"]) : 21,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
