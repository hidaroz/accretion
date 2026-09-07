import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import {
  findSessionNotes,
  groupSessions,
  type SessionNote,
} from "../engine/lifecycle/session-scan.js";
import { handleToolError } from "../engine/utils/errors.js";
import { logger } from "../engine/utils/logger.js";

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

  return {
    path: `sessions/digests/${period}-${project}.md`,
    content: `# ${title}\n\n${sections.join("\n\n")}`,
    frontmatter: {
      title,
      tags: ["type/digest", `project/${project}`],
      period,
      session_count: notes.length,
      sources: notes.map((n) => n.relativePath),
      created: new Date().toISOString(),
      generated_by: "consolidate_sessions/mechanical",
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
        "Mechanical fallback — prefer the /memory-weekly LLM digest workflow. Merge session notes into per-project weekly or monthly digest notes (dedup + concatenate, no synthesis). Source notes are preserved. Use dry_run=true (default) to preview.",
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
            "Filter to specific project slug (e.g., 'atlas-web-app'). Omit for all projects."
          ),
        min_sessions: z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .default(2)
          .describe("Minimum sessions per group to consolidate (default 2)"),
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
    async ({ vault: vaultId, period, project: projectFilter, min_sessions, dry_run }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const vaultRoot = ctx.vault.root;

        const { sessions } = await findSessionNotes(vaultRoot);
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

        const groups = groupSessions(filtered, period);

        const digestsToCreate: ReturnType<typeof buildDigest>[] = [];
        for (const [key, notes] of groups) {
          if (notes.length < min_sessions) continue;
          const [proj, periodKey] = key.split(":");
          digestsToCreate.push(buildDigest(proj, periodKey, notes));
        }

        if (digestsToCreate.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No groups with ${min_sessions}+ sessions found for ${period}ly consolidation.`,
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
