#!/usr/bin/env node

/**
 * Archive old session notes into sessions/archive/. By default only
 * sessions already covered by a digest's `sources` frontmatter are
 * archived (nothing is archived before it has been synthesized), and the
 * run is a dry run.
 *
 * Usage:
 *   node scripts/memory-archive.mjs [--vault work] [--days 30] [--apply] [--no-require-digest]
 *
 * Requires `npm run build` (imports compiled dist/).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { findSessionNotes } from "../dist/vault/session-scan.js";
import { getDigestedSessionPaths } from "../dist/vault/digest-candidates.js";

const args = parseArgs(process.argv.slice(2));

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const daysOld = args.days ? Number(args.days) : 30;
  const apply = args.apply === true;
  const requireDigest = args["no-require-digest"] !== true;
  const cutoff = new Date(Date.now() - daysOld * 24 * 3600000);

  const { sessions } = await findSessionNotes(vaultRoot);
  let toArchive = sessions.filter((s) => s.createdAt < cutoff);

  let skippedUndigested = 0;
  if (requireDigest) {
    const digested = await getDigestedSessionPaths(vaultRoot);
    const before = toArchive.length;
    toArchive = toArchive.filter((s) => digested.has(s.relativePath));
    skippedUndigested = before - toArchive.length;
  }

  toArchive.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (!apply) {
    console.log(`Dry run — would archive ${toArchive.length} session(s):`);
    for (const s of toArchive) {
      console.log(`  ${s.relativePath} (${s.createdAt.toISOString().slice(0, 10)})`);
    }
    if (skippedUndigested > 0) {
      console.log(
        `Skipped ${skippedUndigested} old session(s) not yet covered by a digest.`
      );
    }
    console.log("Re-run with --apply to move them.");
    process.exit(0);
  }

  let moved = 0;
  for (const s of toArchive) {
    const srcAbs = path.join(vaultRoot, s.relativePath);
    const archivePath = s.relativePath.replace(
      /^sessions\//,
      "sessions/archive/"
    );
    const destAbs = path.join(vaultRoot, archivePath);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.rename(srcAbs, destAbs);
    moved++;
  }

  console.log(`Archived ${moved} session(s) to sessions/archive/.`);
  if (skippedUndigested > 0) {
    console.log(
      `Skipped ${skippedUndigested} old session(s) not yet covered by a digest.`
    );
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
