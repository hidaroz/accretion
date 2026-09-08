import fs from "node:fs/promises";
import path from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { loadBriefMap } from "../retrieval/brief-map-loader.js";
import { findSessionNotes } from "./session-scan.js";

export interface StaleBriefSession {
  path: string;
  title: string;
  created: string;
  matchedKeywords: string[];
}

export interface StaleBrief {
  briefPath: string;
  reviewDate: string;
  reviewDateSource: "last_reviewed" | "updated" | "mtime";
  keywords: string[];
  matchedSessions: StaleBriefSession[];
}

export interface StaleBriefsOptions {
  staleDays?: number;
}

const PROPOSALS_DIR = "proposals/brief-updates";

/** Invert the keyword→path brief map into path→keywords. */
export function invertBriefMap(
  map: Record<string, string>
): Map<string, string[]> {
  const inverted = new Map<string, string[]>();
  for (const [keyword, briefPath] of Object.entries(map)) {
    if (typeof briefPath !== "string" || !briefPath.trim()) continue;
    const normalized = briefPath.replace(/^\.\//, "");
    const keywords = inverted.get(normalized) ?? [];
    keywords.push(keyword);
    inverted.set(normalized, keywords);
  }
  return inverted;
}

export function coerceDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Review date fallback chain: last_reviewed → updated → file mtime. */
export function getBriefReviewDate(
  frontmatter: Record<string, unknown>,
  mtime: Date
): { date: Date; source: StaleBrief["reviewDateSource"] } {
  const lastReviewed = coerceDate(frontmatter.last_reviewed);
  if (lastReviewed) return { date: lastReviewed, source: "last_reviewed" };

  const updated = coerceDate(frontmatter.updated);
  if (updated) return { date: updated, source: "updated" };

  return { date: mtime, source: "mtime" };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary keyword match ("rls" must not match "girls"). */
export function matchesKeyword(text: string, keyword: string): boolean {
  const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
  return regex.test(text);
}

/** Brief paths that already have an open (status: proposed) update proposal. */
async function getOpenProposalTargets(vaultRoot: string): Promise<Set<string>> {
  const targets = new Set<string>();
  const dir = path.join(vaultRoot, PROPOSALS_DIR);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return targets;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry.name), "utf-8");
      const { frontmatter } = parseNote(raw);
      if (
        frontmatter.status === "proposed" &&
        typeof frontmatter.target_brief === "string"
      ) {
        targets.add(frontmatter.target_brief.replace(/^\.\//, ""));
      }
    } catch {
      // skip unreadable
    }
  }

  return targets;
}

/**
 * Find briefs that haven't been reviewed in `staleDays` AND have related
 * session activity since their review date (keyword overlap between the
 * brief-map vocabulary and session title/topics/files text). Briefs with
 * an open update proposal are excluded.
 */
export async function getStaleBriefs(
  vaultRoot: string,
  options: StaleBriefsOptions = {}
): Promise<StaleBrief[]> {
  const staleDays = options.staleDays ?? 21;
  const staleCutoff = Date.now() - staleDays * 24 * 3600000;

  const briefMap = await loadBriefMap(vaultRoot);
  const inverted = invertBriefMap(briefMap);
  if (inverted.size === 0) return [];

  const openProposals = await getOpenProposalTargets(vaultRoot);
  const { sessions } = await findSessionNotes(vaultRoot);

  const results: StaleBrief[] = [];

  for (const [briefPath, keywords] of inverted) {
    if (openProposals.has(briefPath)) continue;

    const absPath = path.join(vaultRoot, briefPath);
    let raw: string;
    let mtime: Date;
    try {
      raw = await fs.readFile(absPath, "utf-8");
      mtime = (await fs.stat(absPath)).mtime;
    } catch {
      // brief-map points at a missing note — skip gracefully
      continue;
    }

    const { frontmatter } = parseNote(raw);
    const { date: reviewDate, source } = getBriefReviewDate(
      frontmatter,
      mtime
    );

    if (reviewDate.getTime() > staleCutoff) continue;

    const matchedSessions: StaleBriefSession[] = [];
    for (const session of sessions) {
      if (session.createdAt.getTime() <= reviewDate.getTime()) continue;

      const text = [
        session.title,
        ...session.topics,
        ...session.filesChanged,
      ].join("\n");
      const matched = keywords.filter((k) => matchesKeyword(text, k));

      if (matched.length > 0) {
        matchedSessions.push({
          path: session.relativePath,
          title: session.title,
          created: session.createdAt.toISOString(),
          matchedKeywords: matched,
        });
      }
    }

    if (matchedSessions.length > 0) {
      matchedSessions.sort((a, b) => a.created.localeCompare(b.created));
      results.push({
        briefPath,
        reviewDate: reviewDate.toISOString(),
        reviewDateSource: source,
        keywords,
        matchedSessions,
      });
    }
  }

  results.sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));
  return results;
}
