#!/usr/bin/env node

/**
 * Archive old session notes into sessions/archive/. By default only
 * sessions already covered by a digest's `sources` frontmatter are
 * archived (nothing is archived before it has been synthesized), and the
 * run is a dry run.
 *
 * Usage:
 *   node scripts/memory-archive.mjs [--vault demo] [--days 30] [--apply] [--no-require-digest]
 *
 * Requires `npm run build` (imports compiled dist/). Superseded by `accretion archive`.
 */

import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { archiveSessions } from "../dist/engine/lifecycle/archive.js";

const args = parseArgs(process.argv.slice(2));

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const result = await archiveSessions(vaultRoot, {
    daysOld: args.days ? Number(args.days) : 30,
    requireDigest: args["no-require-digest"] !== true,
    apply: args.apply === true,
  });

  if (!result.applied) {
    console.log(`Dry run: would archive ${result.candidates.length} session(s):`);
    for (const c of result.candidates) console.log(`  ${c.path} (${c.created})`);
    if (result.skippedUndigested > 0) {
      console.log(`Skipped ${result.skippedUndigested} old session(s) not yet covered by a digest.`);
    }
    if (result.candidates.length > 0) console.log("Re-run with --apply to move them.");
    process.exit(0);
  }

  console.log(`Archived ${result.renames.length} session(s) to sessions/archive/.`);
  if (result.repointedDigests > 0) console.log(`Repointed source links in ${result.repointedDigests} digest(s).`);
  if (result.skippedUndigested > 0) {
    console.log(`Skipped ${result.skippedUndigested} old session(s) not yet covered by a digest.`);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
