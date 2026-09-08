// Append-only vault event log with a fixed, greppable line grammar:
//
//   ## [YYYY-MM-DD] <kind> | <title> | <path>
//
// "What happened recently" is then `grep '^## \[' 00-Index/log.md | tail -5`
// with no index and no server. Every writer (capture hook, digest, proposal,
// apply, archive) appends one line; nothing rewrites earlier lines.

import fs from "node:fs/promises";
import path from "node:path";

export const LOG_PATH = "00-Index/log.md";

export type LogKind =
  | "capture"
  | "digest"
  | "proposal"
  | "applied"
  | "archive"
  | "index";

export interface LogEntry {
  date: string;
  kind: LogKind;
  title: string;
  path: string;
}

const HEADER = [
  "---",
  "title: Vault log",
  "tags:",
  "  - type/log",
  "---",
  "",
  "# Vault log",
  "",
  "Append-only. One line per event, newest last:",
  "`## [YYYY-MM-DD] kind | title | path`. Recent activity: `grep '^## \\[' 00-Index/log.md | tail -5`.",
  "",
].join("\n");

function clean(s: string): string {
  return s.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function formatLogLine(entry: LogEntry): string {
  return `## [${entry.date}] ${entry.kind} | ${clean(entry.title)} | ${clean(entry.path)}`;
}

const LINE = /^## \[(\d{4}-\d{2}-\d{2})\] (\w[\w-]*) \| (.*?) \| (.*)$/;

export function parseLogLine(line: string): LogEntry | null {
  const m = line.match(LINE);
  if (!m) return null;
  return { date: m[1], kind: m[2] as LogKind, title: m[3].trim(), path: m[4].trim() };
}

export async function appendLog(
  vaultRoot: string,
  entry: Omit<LogEntry, "date"> & { date?: string }
): Promise<LogEntry> {
  const full: LogEntry = {
    date: entry.date ?? new Date().toISOString().slice(0, 10),
    kind: entry.kind,
    title: entry.title,
    path: entry.path,
  };
  const abs = path.join(vaultRoot, LOG_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(abs, "utf-8");
  } catch {
    existing = HEADER;
  }
  const sep = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  await fs.writeFile(abs, `${existing}${sep}${formatLogLine(full)}\n`, "utf-8");
  return full;
}

export async function readLog(
  vaultRoot: string,
  options: { last?: number; kind?: LogKind } = {}
): Promise<LogEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(vaultRoot, LOG_PATH), "utf-8");
  } catch {
    return [];
  }
  let entries = raw
    .split("\n")
    .map(parseLogLine)
    .filter((e): e is LogEntry => e !== null);
  if (options.kind) entries = entries.filter((e) => e.kind === options.kind);
  if (options.last !== undefined) entries = entries.slice(-options.last);
  return entries;
}
