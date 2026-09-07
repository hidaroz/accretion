import fs from "node:fs/promises";
import path from "node:path";
import { parseNote, extractTitle, extractTags } from "../vault/frontmatter.js";

export interface SessionNote {
  relativePath: string;
  title: string;
  tags: string[];
  createdAt: Date;
  malformedDate: boolean;
  topics: string[];
  filesChanged: string[];
  decisions: string[];
  project: string;
}

export interface SessionScanResult {
  sessions: SessionNote[];
  malformedDates: string[];
}

/**
 * Blank out fenced code block regions so structural parsing (headings,
 * sections) never matches content inside code blocks. Line count is
 * preserved.
 */
export function stripCodeBlocks(content: string): string {
  const lines = content.split("\n");
  let fence: { char: string; len: number } | null = null;

  const out = lines.map((line) => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) {
      const char = m[1][0];
      const len = m[1].length;
      if (!fence) {
        fence = { char, len };
      } else if (char === fence.char && len >= fence.len) {
        fence = null;
      }
      return "";
    }
    return fence ? "" : line;
  });

  return out.join("\n");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the bullet items under a `## <heading>` section. Headings inside
 * fenced code blocks are ignored.
 */
export function extractSection(content: string, heading: string): string[] {
  const stripped = stripCodeBlocks(content);
  // No "m" flag: `$` must mean end-of-document, not end-of-line, or the
  // lazy capture stops after the first bullet.
  const regex = new RegExp(
    `(?:^|\\n)## ${escapeRegExp(heading)}[ \\t]*\\n([\\s\\S]*?)(?=\\n## |$)`
  );
  const match = stripped.match(regex);
  if (!match) return [];

  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * Parse a note's `created` frontmatter into a Date, falling back to the
 * file mtime. A string that fails to parse is flagged as malformed instead
 * of silently producing an Invalid Date.
 */
export function parseCreated(
  frontmatter: Record<string, unknown>,
  fallbackMtime: Date
): { date: Date; malformed: boolean } {
  const created = frontmatter.created;

  if (created instanceof Date && !Number.isNaN(created.getTime())) {
    return { date: created, malformed: false };
  }

  if (typeof created === "string") {
    const d = new Date(created);
    if (!Number.isNaN(d.getTime())) {
      return { date: d, malformed: false };
    }
    return { date: fallbackMtime, malformed: true };
  }

  return { date: fallbackMtime, malformed: false };
}

export function extractProjectTag(tags: string[]): string {
  const projectTag = tags.find((t) => t.startsWith("project/"));
  return projectTag ? projectTag.replace("project/", "") : "unknown";
}

export function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function getYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Find all live session notes (tagged type/session) under sessions/,
 * skipping archive/ and digests/.
 */
export async function findSessionNotes(
  vaultRoot: string
): Promise<SessionScanResult> {
  const sessions: SessionNote[] = [];
  const malformedDates: string[] = [];
  const sessionsDir = path.join(vaultRoot, "sessions");

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "archive" || entry.name === "digests") continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const raw = await fs.readFile(fullPath, "utf-8");
          const { frontmatter, content } = parseNote(raw);
          const tags = extractTags(frontmatter, raw);

          if (!tags.includes("type/session")) continue;

          const relativePath = path.relative(vaultRoot, fullPath);
          const mtime = (await fs.stat(fullPath)).mtime;
          const { date: createdAt, malformed } = parseCreated(
            frontmatter,
            mtime
          );
          if (malformed) malformedDates.push(relativePath);

          sessions.push({
            relativePath,
            title: extractTitle(frontmatter, content, relativePath),
            tags,
            createdAt,
            malformedDate: malformed,
            topics: extractSection(content, "Topics"),
            filesChanged: extractSection(content, "Files Changed"),
            decisions: extractSection(content, "Decisions"),
            project: extractProjectTag(tags),
          });
        } catch {
          // skip unreadable
        }
      }
    }
  }

  await walk(sessionsDir);
  return { sessions, malformedDates };
}

/**
 * Group sessions by `${project}:${periodKey}` for the given period.
 */
export function groupSessions(
  sessions: SessionNote[],
  period: "week" | "month"
): Map<string, SessionNote[]> {
  const groups = new Map<string, SessionNote[]>();
  for (const session of sessions) {
    const periodKey =
      period === "week"
        ? getISOWeek(session.createdAt)
        : getYearMonth(session.createdAt);
    const key = `${session.project}:${periodKey}`;
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }
  return groups;
}
