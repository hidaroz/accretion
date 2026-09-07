#!/usr/bin/env node

/**
 * Print project+period session groups needing a digest, as JSON.
 *
 * Usage:
 *   node scripts/memory-digest-candidates.mjs [--vault demo] [--period week|month] [--project <slug>] [--min-sessions N]
 *
 * Requires `npm run build` (imports compiled dist/).
 */

import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { getDigestCandidates } from "../dist/engine/lifecycle/digest-candidates.js";

const args = parseArgs(process.argv.slice(2));

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const result = await getDigestCandidates(vaultRoot, {
    period: args.period === "month" ? "month" : "week",
    project: typeof args.project === "string" ? args.project : undefined,
    minSessions: args["min-sessions"] ? Number(args["min-sessions"]) : 1,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
