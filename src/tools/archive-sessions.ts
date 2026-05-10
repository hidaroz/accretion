import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { parseNote, extractTags } from "../vault/frontmatter.js";
import { handleToolError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface SessionCandidate {
  relativePath: string;
  createdAt: Date;
}

async function findSessionNotes(
  vaultRoot: string,
  sessionsDir: string
): Promise<SessionCandidate[]> {
  const candidates: SessionCandidate[] = [];
  const absDir = path.join(vaultRoot, sessionsDir);

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(vaultRoot, fullPath);

      if (entry.isDirectory()) {
        if (entry.name === "archive" || entry.name === "digests") continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const raw = await fs.readFile(fullPath, "utf-8");
          const { frontmatter } = parseNote(raw);
          const tags = extractTags(frontmatter, raw);

          if (!tags.includes("type/session")) continue;

          const createdAt =
            typeof frontmatter.created === "string"
              ? new Date(frontmatter.created)
              : (await fs.stat(fullPath)).mtime;

          candidates.push({ relativePath: rel, createdAt });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(absDir);
  return candidates;
}

export function registerArchiveSessions(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "archive_sessions",
    {
      description:
        "Move session notes older than a threshold to sessions/archive/. Archived notes are excluded from the live search index. Use dry_run=true (default) to preview before moving.",
      inputSchema: {
        vault: z
          .string()
          .optional()
          .describe("Vault ID. Omit for default vault."),
        days_old: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .default(30)
          .describe(
            "Archive sessions older than this many days (default 30)"
          ),
        dry_run: z.coerce
          .boolean()
          .optional()
          .default(true)
          .describe(
            "If true, report what would be moved without moving (default true)"
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, days_old, dry_run }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const vaultRoot = ctx.vault.root;
        const cutoff = new Date(Date.now() - days_old * 24 * 3600000);

        const candidates = await findSessionNotes(vaultRoot, "sessions");
        const toArchive = candidates.filter((c) => c.createdAt < cutoff);

        if (toArchive.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No session notes older than ${days_old} days found.`,
              },
            ],
          };
        }

        toArchive.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
        const oldest = toArchive[0].createdAt.toISOString().slice(0, 10);
        const newest = toArchive[toArchive.length - 1].createdAt
          .toISOString()
          .slice(0, 10);

        if (dry_run) {
          const paths = toArchive.map((c) => `- \`${c.relativePath}\``);
          return {
            content: [
              {
                type: "text" as const,
                text: `**Dry run:** Would archive ${toArchive.length} session note(s) (oldest: ${oldest}, newest: ${newest}).\n\n${paths.join("\n")}`,
              },
            ],
          };
        }

        let moved = 0;
        for (const candidate of toArchive) {
          const srcAbs = path.join(vaultRoot, candidate.relativePath);
          const archivePath = candidate.relativePath.replace(
            /^sessions\//,
            "sessions/archive/"
          );
          const destAbs = path.join(vaultRoot, archivePath);

          await fs.mkdir(path.dirname(destAbs), { recursive: true });
          await fs.rename(srcAbs, destAbs);

          ctx.searchIndex.remove(candidate.relativePath);
          ctx.tagIndex.removeNote(candidate.relativePath);
          moved++;
        }

        logger.info("Archived session notes", {
          vault: ctx.id,
          count: moved,
          oldest,
          newest,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Archived ${moved} session note(s) to \`sessions/archive/\` (oldest: ${oldest}, newest: ${newest}).`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "archive_sessions");
      }
    }
  );
}
