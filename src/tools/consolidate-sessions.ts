import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { parseNote, extractTitle, extractTags } from "../vault/frontmatter.js";
import { handleToolError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface SessionNote {
  relativePath: string;
  title: string;
  tags: string[];
  createdAt: Date;
  topics: string[];
  filesChanged: string[];
  decisions: string[];
  project: string;
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function extractSection(content: string, heading: string): string[] {
  const regex = new RegExp(
    `## ${heading}\\n([\\s\\S]*?)(?=\\n##|$)`,
    "m"
  );
  const match = content.match(regex);
  if (!match) return [];

  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0);
}

function extractProjectTag(tags: string[]): string {
  const projectTag = tags.find((t) => t.startsWith("project/"));
  return projectTag ? projectTag.replace("project/", "") : "unknown";
}

async function findSessionNotes(
  vaultRoot: string
): Promise<SessionNote[]> {
  const sessions: SessionNote[] = [];
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
          const createdAt =
            typeof frontmatter.created === "string"
              ? new Date(frontmatter.created as string)
              : (await fs.stat(fullPath)).mtime;

          sessions.push({
            relativePath,
            title: extractTitle(frontmatter, content, relativePath),
            tags,
            createdAt,
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
  return sessions;
}

function dedup(items: string[]): string[] {
  return [...new Set(items)];
}

function buildDigest(
  project: string,
  period: string,
  notes: SessionNote[]
): { path: string; content: string; frontmatter: Record<string, unknown> } {
  const projectLabel = project.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const title = `${period} Digest — ${projectLabel}`;

  const allTopics = dedup(notes.flatMap((n) => n.topics));
  const allFiles = dedup(notes.flatMap((n) => n.filesChanged));
  const allDecisions = dedup(notes.flatMap((n) => n.decisions));

  const sections: string[] = [];

  if (allTopics.length > 0) {
    sections.push(
      `## Topics\n\n${allTopics.map((t) => `- ${t}`).join("\n")}`
    );
  }

  if (allFiles.length > 0) {
    sections.push(
      `## Files Changed\n\n${allFiles.map((f) => `- ${f}`).join("\n")}`
    );
  }

  if (allDecisions.length > 0) {
    sections.push(
      `## Decisions\n\n${allDecisions.map((d) => `- ${d}`).join("\n")}`
    );
  }

  sections.push(
    `## Source Sessions\n\n${notes.map((n) => `- [[${n.relativePath}|${n.title}]] (${n.createdAt.toISOString().slice(0, 10)})`).join("\n")}`
  );

  const isWeekly = period.includes("W");
  const digestPath = isWeekly
    ? `sessions/digests/${period}-${project}.md`
    : `sessions/digests/${period}-${project}.md`;

  return {
    path: digestPath,
    content: `# ${title}\n\n${sections.join("\n\n")}`,
    frontmatter: {
      title,
      tags: ["type/digest", `project/${project}`],
      period,
      session_count: notes.length,
      created: new Date().toISOString(),
    },
  };
}

export function registerConsolidateSessions(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "consolidate_sessions",
    {
      description:
        "Merge session notes into per-project weekly or monthly digest notes. Purely mechanical (dedup + concatenate). Source notes are preserved. Use dry_run=true (default) to preview.",
      inputSchema: {
        vault: z
          .string()
          .optional()
          .describe("Vault ID. Omit for default vault."),
        period: z
          .enum(["week", "month"])
          .optional()
          .default("week")
          .describe("Grouping period (default 'week')"),
        project: z
          .string()
          .optional()
          .describe(
            "Filter to specific project slug (e.g., 'work-web-app'). Omit for all projects."
          ),
        dry_run: z.coerce
          .boolean()
          .optional()
          .default(true)
          .describe("If true, report what would be created (default true)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, period, project: projectFilter, dry_run }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const vaultRoot = ctx.vault.root;

        const sessions = await findSessionNotes(vaultRoot);
        const filtered = projectFilter
          ? sessions.filter((s) => s.project === projectFilter)
          : sessions;

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No session notes found to consolidate.",
              },
            ],
          };
        }

        // Group by project + period
        const groups = new Map<string, SessionNote[]>();
        for (const session of filtered) {
          const periodKey =
            period === "week"
              ? getISOWeek(session.createdAt)
              : getYearMonth(session.createdAt);
          const key = `${session.project}:${periodKey}`;
          const group = groups.get(key) ?? [];
          group.push(session);
          groups.set(key, group);
        }

        // Only consolidate groups with 2+ sessions
        const digestsToCreate: ReturnType<typeof buildDigest>[] = [];
        for (const [key, notes] of groups) {
          if (notes.length < 2) continue;
          const [proj, periodKey] = key.split(":");
          digestsToCreate.push(buildDigest(proj, periodKey, notes));
        }

        if (digestsToCreate.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No groups with 2+ sessions found for ${period}ly consolidation.`,
              },
            ],
          };
        }

        if (dry_run) {
          const lines = digestsToCreate.map(
            (d) =>
              `- \`${d.path}\` (${d.frontmatter.session_count} sessions)`
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `**Dry run:** Would create ${digestsToCreate.length} digest(s):\n\n${lines.join("\n")}`,
              },
            ],
          };
        }

        let created = 0;
        let skipped = 0;
        for (const digest of digestsToCreate) {
          const absPath = path.join(vaultRoot, digest.path);
          try {
            await fs.access(absPath);
            skipped++;
            continue;
          } catch {
            // doesn't exist, proceed
          }

          await ctx.vault.create(digest.path, digest.content, digest.frontmatter);
          created++;
        }

        logger.info("Consolidated sessions", {
          vault: ctx.id,
          created,
          skipped,
          period,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Created ${created} digest(s)${skipped > 0 ? `, skipped ${skipped} (already exist)` : ""}.`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "consolidate_sessions");
      }
    }
  );
}
