import fs from "node:fs/promises";
import path from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import {
  findSessionNotes,
  groupSessions,
  type SessionNote,
} from "./session-scan.js";

export interface DigestCandidateSession {
  relativePath: string;
  title: string;
  created: string;
  topics: string[];
  filesChangedCount: number;
}

export interface DigestCandidateGroup {
  project: string;
  period: string;
  digestPath: string;
  exists: boolean;
  sessions: DigestCandidateSession[];
}

export interface DigestCandidatesResult {
  groups: DigestCandidateGroup[];
  malformedDates: string[];
}

export interface DigestCandidatesOptions {
  period?: "week" | "month";
  minSessions?: number;
  project?: string;
}

/**
 * Enumerate project+period session groups and whether a digest note
 * already exists for each. Pure data gathering — synthesis happens
 * downstream (the /memory-weekly skill or the mechanical tool).
 */
export async function getDigestCandidates(
  vaultRoot: string,
  options: DigestCandidatesOptions = {}
): Promise<DigestCandidatesResult> {
  const period = options.period ?? "week";
  const minSessions = options.minSessions ?? 1;

  const { sessions, malformedDates } = await findSessionNotes(vaultRoot);
  const filtered = options.project
    ? sessions.filter((s) => s.project === options.project)
    : sessions;

  const grouped = groupSessions(filtered, period);
  const groups: DigestCandidateGroup[] = [];

  for (const [key, notes] of grouped) {
    if (notes.length < minSessions) continue;

    const [project, periodKey] = key.split(":");
    const digestPath = `sessions/digests/${periodKey}-${project}.md`;

    let exists = false;
    try {
      await fs.access(path.join(vaultRoot, digestPath));
      exists = true;
    } catch {
      // doesn't exist
    }

    notes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    groups.push({
      project,
      period: periodKey,
      digestPath,
      exists,
      sessions: notes.map((n: SessionNote) => ({
        relativePath: n.relativePath,
        title: n.title,
        created: n.createdAt.toISOString(),
        topics: n.topics,
        filesChangedCount: n.filesChanged.length,
      })),
    });
  }

  groups.sort(
    (a, b) =>
      a.period.localeCompare(b.period) || a.project.localeCompare(b.project)
  );

  return { groups, malformedDates };
}

/**
 * Session paths covered by an existing digest (listed in a digest note's
 * `sources` frontmatter). Used to guarantee sessions are never archived
 * before they've been synthesized.
 */
export async function getDigestedSessionPaths(
  vaultRoot: string
): Promise<Set<string>> {
  const covered = new Set<string>();
  const digestsDir = path.join(vaultRoot, "sessions", "digests");

  let entries;
  try {
    entries = await fs.readdir(digestsDir, { withFileTypes: true });
  } catch {
    return covered;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(
        path.join(digestsDir, entry.name),
        "utf-8"
      );
      const { frontmatter } = parseNote(raw);
      if (Array.isArray(frontmatter.sources)) {
        for (const src of frontmatter.sources) {
          if (typeof src === "string") covered.add(src.replace(/^\.\//, ""));
        }
      }
    } catch {
      // skip unreadable
    }
  }

  return covered;
}
