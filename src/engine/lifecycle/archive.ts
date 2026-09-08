// Archive digest-covered session notes into sessions/archive/, and keep every
// digest pointing at where its sources now live. One implementation for the CLI
// and the MCP adapter so the scheduled path and the interactive path cannot drift.

import fs from "node:fs/promises";
import path from "node:path";
import { findSessionNotes } from "./session-scan.js";
import { getDigestedSessionPaths } from "./digest-candidates.js";
import { appendLog } from "./log.js";

export interface ArchiveOptions {
  /** Archive sessions older than this many days (default 30). */
  daysOld?: number;
  /** Only archive sessions listed in some digest's `sources` (default true). */
  requireDigest?: boolean;
  /** Move files. Default false = report only. */
  apply?: boolean;
  /** Injected clock. */
  now?: Date;
  /** Called for each moved note so live indexes can drop it. */
  onMoved?: (from: string, to: string) => void;
}

export interface ArchiveResult {
  candidates: Array<{ path: string; created: string }>;
  /** Only populated when `apply` is true. */
  renames: Array<{ from: string; to: string }>;
  repointedDigests: number;
  skippedUndigested: number;
  oldest: string | null;
  newest: string | null;
  applied: boolean;
}

export function archivePathFor(relativePath: string): string {
  return relativePath.replace(/^sessions\//, "sessions/archive/");
}

export async function archiveSessions(
  vaultRoot: string,
  options: ArchiveOptions = {}
): Promise<ArchiveResult> {
  const daysOld = options.daysOld ?? 30;
  const requireDigest = options.requireDigest ?? true;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - daysOld * 24 * 3600000);

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

  const result: ArchiveResult = {
    candidates: toArchive.map((s) => ({
      path: s.relativePath,
      created: s.createdAt.toISOString().slice(0, 10),
    })),
    renames: [],
    repointedDigests: 0,
    skippedUndigested,
    oldest: toArchive[0]?.createdAt.toISOString().slice(0, 10) ?? null,
    newest: toArchive[toArchive.length - 1]?.createdAt.toISOString().slice(0, 10) ?? null,
    applied: false,
  };

  if (!options.apply || toArchive.length === 0) return result;

  const renames = new Map<string, string>();
  for (const s of toArchive) {
    const to = archivePathFor(s.relativePath);
    const destAbs = path.join(vaultRoot, to);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.rename(path.join(vaultRoot, s.relativePath), destAbs);
    renames.set(s.relativePath, to);
    options.onMoved?.(s.relativePath, to);
  }
  result.renames = [...renames].map(([from, to]) => ({ from, to }));
  result.repointedDigests = await repointDigests(vaultRoot, renames);
  result.applied = true;

  await appendLog(vaultRoot, {
    kind: "archive",
    title: `${renames.size} session(s) archived (${result.oldest}..${result.newest})`,
    path: "sessions/archive/",
    date: now.toISOString().slice(0, 10),
  });

  return result;
}

/**
 * Point every digest at where its sources now live.
 *
 * A digest records the exact paths it was synthesised from, in `sources`
 * frontmatter and in its `## Source Sessions` wikilinks. `sources` is not
 * decorative: `getDigestedSessionPaths` reads it to decide what is safe to
 * archive, so a digest that has lost track of its own sources stops protecting
 * them. Archiving without repointing once stranded 92 links in one run.
 */
export async function repointDigests(
  vaultRoot: string,
  renames: Map<string, string>
): Promise<number> {
  if (renames.size === 0) return 0;

  const digestsDir = path.join(vaultRoot, "sessions", "digests");
  let files: string[];
  try {
    files = (await fs.readdir(digestsDir)).filter((f) => f.endsWith(".md"));
  } catch {
    return 0;
  }

  let changed = 0;
  for (const file of files) {
    const full = path.join(digestsDir, file);
    const before = await fs.readFile(full, "utf8");
    let after = before;
    for (const [from, to] of renames) {
      if (after.includes(from)) after = after.split(from).join(to);
    }
    if (after !== before) {
      await fs.writeFile(full, after, "utf8");
      changed++;
    }
  }
  return changed;
}
