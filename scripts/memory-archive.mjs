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
 * Requires `npm run build` (imports compiled dist/).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { findSessionNotes } from "../dist/vault/session-scan.js";
import { getDigestedSessionPaths } from "../dist/vault/digest-candidates.js";
import { repointDigests } from "../dist/tools/archive-sessions.js";

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
  const renames = new Map();
  for (const s of toArchive) {
    const srcAbs = path.join(vaultRoot, s.relativePath);
    const archivePath = s.relativePath.replace(
      /^sessions\//,
      "sessions/archive/"
    );
    const destAbs = path.join(vaultRoot, archivePath);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.rename(srcAbs, destAbs);
    renames.set(s.relativePath, archivePath);
    moved++;
  }

  // Digests record the exact paths they were built from, and archiving used to
  // move the files out from under them — the June 2026 run stranded 92 source
  // links. Shared with the MCP tool so the scheduled path and the interactive
  // path cannot drift apart again.
  const repointed = await repointDigests(vaultRoot, renames);

  console.log(`Archived ${moved} session(s) to sessions/archive/.`);
  if (repointed > 0) {
    console.log(`Repointed source links in ${repointed} digest(s).`);
  }
  if (skippedUndigested > 0) {
    console.log(
      `Skipped ${skippedUndigested} old session(s) not yet covered by a digest.`
    );
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
