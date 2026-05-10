#!/usr/bin/env node

/**
 * Standalone session consolidation script for cron use.
 * Reads vault config and merges session notes into weekly digests.
 *
 * Usage:
 *   node scripts/consolidate-sessions.mjs [--period week|month] [--vault <id>] [--dry-run]
 *
 * Crontab example (weekly Monday at midnight):
 *   0 0 * * 1 node /path/to/obsidian-mcp-server/scripts/consolidate-sessions.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const VAULTS_CONFIG =
  process.env.VAULTS_CONFIG ||
  path.join(
    process.env.HOME || "",
    ".config",
    "obsidian-mcp",
    "vaults.json"
  );

// --- Argument parsing ---

const args = process.argv.slice(2);
const period = getArg("--period") || "week";
const vaultFilter = getArg("--vault");
const dryRun = args.includes("--dry-run");

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

// --- YAML-like frontmatter parser (minimal) ---

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };

  const fm = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    if (val.startsWith("'") && val.endsWith("'"))
      val = val.slice(1, -1);
    if (val.startsWith('"') && val.endsWith('"'))
      val = val.slice(1, -1);
    fm[key] = val;
  }

  return { frontmatter: fm, content: match[2] };
}

function extractTags(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const tagsMatch = match[1].match(/tags:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (!tagsMatch) return [];
  return tagsMatch[1]
    .split("\n")
    .map((l) => l.replace(/^\s+-\s+/, "").trim())
    .filter(Boolean);
}

function extractSection(content, heading) {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n##|$)`, "m");
  const match = content.match(regex);
  if (!match) return [];
  return match[1]
    .trim()
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l.length > 0);
}

function getISOWeek(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getYearMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dedup(items) {
  return [...new Set(items)];
}

// --- Main ---

async function main() {
  const raw = await fs.readFile(VAULTS_CONFIG, "utf-8");
  const { vaults } = JSON.parse(raw);

  const targetVaults = vaultFilter
    ? vaults.filter((v) => v.id === vaultFilter)
    : vaults;

  if (targetVaults.length === 0) {
    console.error(`No vault found matching "${vaultFilter}"`);
    process.exit(1);
  }

  let totalCreated = 0;

  for (const vault of targetVaults) {
    const vaultRoot = vault.path;
    const sessionsDir = path.join(vaultRoot, "sessions");

    // Find all session notes
    const sessions = [];
    await walkSessions(sessionsDir, vaultRoot, sessions);

    if (sessions.length === 0) continue;

    // Group by project + period
    const groups = new Map();
    for (const session of sessions) {
      const periodKey =
        period === "week"
          ? getISOWeek(session.createdAt)
          : getYearMonth(session.createdAt);
      const key = `${session.project}:${periodKey}`;
      const group = groups.get(key) || [];
      group.push(session);
      groups.set(key, group);
    }

    for (const [key, notes] of groups) {
      if (notes.length < 2) continue;

      const [proj, periodKey] = key.split(":");
      const digestPath = `sessions/digests/${periodKey}-${proj}.md`;
      const absDigest = path.join(vaultRoot, digestPath);

      // Skip if already exists
      try {
        await fs.access(absDigest);
        continue;
      } catch {
        // doesn't exist
      }

      const projectLabel = proj.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const title = `${periodKey} Digest — ${projectLabel}`;
      const allTopics = dedup(notes.flatMap((n) => n.topics));
      const allFiles = dedup(notes.flatMap((n) => n.filesChanged));
      const allDecisions = dedup(notes.flatMap((n) => n.decisions));

      const sections = [];
      if (allTopics.length > 0)
        sections.push(`## Topics\n\n${allTopics.map((t) => `- ${t}`).join("\n")}`);
      if (allFiles.length > 0)
        sections.push(`## Files Changed\n\n${allFiles.map((f) => `- ${f}`).join("\n")}`);
      if (allDecisions.length > 0)
        sections.push(`## Decisions\n\n${allDecisions.map((d) => `- ${d}`).join("\n")}`);
      sections.push(
        `## Source Sessions\n\n${notes.map((n) => `- [[${n.relativePath}|${n.title}]] (${n.createdAt.toISOString().slice(0, 10)})`).join("\n")}`
      );

      const fm = [
        "---",
        `title: '${title}'`,
        "tags:",
        "  - type/digest",
        `  - project/${proj}`,
        `period: '${periodKey}'`,
        `session_count: ${notes.length}`,
        `created: '${new Date().toISOString()}'`,
        "---",
      ].join("\n");

      const body = `# ${title}\n\n${sections.join("\n\n")}`;
      const fileContent = `${fm}\n\n${body}\n`;

      if (dryRun) {
        console.log(`[dry-run] Would create: ${digestPath} (${notes.length} sessions)`);
      } else {
        await fs.mkdir(path.dirname(absDigest), { recursive: true });
        await fs.writeFile(absDigest, fileContent, "utf-8");
        console.log(`Created: ${digestPath} (${notes.length} sessions)`);
        totalCreated++;

        // Git commit if vault has gitAutoCommit
        if (vault.gitAutoCommit) {
          try {
            await execFile("git", ["add", digestPath], { cwd: vaultRoot });
            await execFile(
              "git",
              ["commit", "-m", `Session digest: ${title.slice(0, 60)}`],
              { cwd: vaultRoot }
            );
          } catch {
            // silent
          }
        }
      }
    }
  }

  if (!dryRun) {
    console.log(`Done. Created ${totalCreated} digest(s).`);
  }
}

async function walkSessions(dir, vaultRoot, results) {
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
      await walkSessions(fullPath, vaultRoot, results);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const raw = await fs.readFile(fullPath, "utf-8");
        const tags = extractTags(raw);
        if (!tags.includes("type/session")) continue;

        const { frontmatter, content } = parseFrontmatter(raw);
        const relativePath = path.relative(vaultRoot, fullPath);
        const createdAt = frontmatter.created
          ? new Date(frontmatter.created)
          : (await fs.stat(fullPath)).mtime;

        const projectTag = tags.find((t) => t.startsWith("project/"));
        const project = projectTag
          ? projectTag.replace("project/", "")
          : "unknown";

        results.push({
          relativePath,
          title: frontmatter.title || path.basename(fullPath, ".md"),
          tags,
          createdAt,
          topics: extractSection(content, "Topics"),
          filesChanged: extractSection(content, "Files Changed"),
          decisions: extractSection(content, "Decisions"),
          project,
        });
      } catch {
        // skip
      }
    }
  }
}

main().catch((err) => {
  console.error("Consolidation failed:", err.message);
  process.exit(1);
});
