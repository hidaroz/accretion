import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { findSessionNotes } from "../vault/session-scan.js";
import { getDigestedSessionPaths } from "../vault/digest-candidates.js";
import { handleToolError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

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
        require_digest: z.coerce
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, only archive sessions already covered by a digest's `sources` frontmatter (default false)"
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
    async ({ vault: vaultId, days_old, require_digest, dry_run }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const vaultRoot = ctx.vault.root;
        const cutoff = new Date(Date.now() - days_old * 24 * 3600000);

        const { sessions } = await findSessionNotes(vaultRoot);
        let toArchive = sessions.filter((c) => c.createdAt < cutoff);

        let skippedUndigested = 0;
        if (require_digest) {
          const digested = await getDigestedSessionPaths(vaultRoot);
          const before = toArchive.length;
          toArchive = toArchive.filter((c) => digested.has(c.relativePath));
          skippedUndigested = before - toArchive.length;
        }

        if (toArchive.length === 0) {
          const suffix =
            skippedUndigested > 0
              ? ` (${skippedUndigested} old session(s) skipped — not yet covered by a digest)`
              : "";
          return {
            content: [
              {
                type: "text" as const,
                text: `No session notes older than ${days_old} days found to archive${suffix}.`,
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
        const skippedNote =
          skippedUndigested > 0
            ? `\n\n${skippedUndigested} old session(s) skipped — not yet covered by a digest.`
            : "";

        if (dry_run) {
          const paths = toArchive.map((c) => `- \`${c.relativePath}\``);
          return {
            content: [
              {
                type: "text" as const,
                text: `**Dry run:** Would archive ${toArchive.length} session note(s) (oldest: ${oldest}, newest: ${newest}).\n\n${paths.join("\n")}${skippedNote}`,
              },
            ],
          };
        }

        let moved = 0;
        const renames = new Map<string, string>();
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
          renames.set(candidate.relativePath, archivePath);
          moved++;
        }

        const repointed = await repointDigests(vaultRoot, renames);

        logger.info("Archived session notes", {
          vault: ctx.id,
          count: moved,
          repointedDigests: repointed,
          oldest,
          newest,
        });

        const repointNote = repointed
          ? ` Repointed source links in ${repointed} digest(s).`
          : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `Archived ${moved} session note(s) to \`sessions/archive/\` (oldest: ${oldest}, newest: ${newest}).${repointNote}${skippedNote}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "archive_sessions");
      }
    }
  );
}

/**
 * Point every digest at where its sources now live.
 *
 * A digest records the exact paths it was synthesized from, in `sources`
 * frontmatter and in its `## Source Sessions` wikilinks. Archiving used to move
 * the files and leave those paths behind: the June 2026 run stranded 92 links
 * across the Work vault, and nothing reported it — `validateStructure` checks
 * dangling links in the curated layer only, and deliberately skips `sessions/`.
 *
 * `sources` is not decorative. `getDigestedSessionPaths` reads it to decide
 * what is safe to archive, so a digest that has lost track of its own sources
 * stops protecting them.
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
