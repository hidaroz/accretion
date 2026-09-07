import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import { archiveSessions } from "../engine/lifecycle/archive.js";
import { handleToolError } from "../engine/utils/errors.js";
import { logger } from "../engine/utils/logger.js";

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
        vault: z.string().optional().describe("Vault ID. Omit for default vault."),
        days_old: z.coerce.number().int().min(0).optional().default(30)
          .describe("Archive sessions older than this many days (default 30)"),
        require_digest: z.coerce.boolean().optional().default(false)
          .describe("If true, only archive sessions already covered by a digest's `sources` frontmatter (default false)"),
        dry_run: z.coerce.boolean().optional().default(true)
          .describe("If true, report what would be moved without moving (default true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ vault: vaultId, days_old, require_digest, dry_run }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const result = await archiveSessions(ctx.vault.root, {
          daysOld: days_old,
          requireDigest: require_digest,
          apply: !dry_run,
          onMoved: (from) => {
            ctx.searchIndex.remove(from);
            ctx.tagIndex.removeNote(from);
          },
        });

        const skippedNote =
          result.skippedUndigested > 0
            ? `\n\n${result.skippedUndigested} old session(s) skipped, not yet covered by a digest.`
            : "";

        if (result.candidates.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No session notes older than ${days_old} days found to archive.${skippedNote}` }],
          };
        }

        if (!result.applied) {
          const paths = result.candidates.map((c) => `- \`${c.path}\``);
          return {
            content: [{
              type: "text" as const,
              text: `**Dry run:** Would archive ${result.candidates.length} session note(s) (oldest: ${result.oldest}, newest: ${result.newest}).\n\n${paths.join("\n")}${skippedNote}`,
            }],
          };
        }

        logger.info("Archived session notes", {
          vault: ctx.id,
          count: result.renames.length,
          repointedDigests: result.repointedDigests,
        });
        const repointNote = result.repointedDigests
          ? ` Repointed source links in ${result.repointedDigests} digest(s).`
          : "";
        return {
          content: [{
            type: "text" as const,
            text: `Archived ${result.renames.length} session note(s) to \`sessions/archive/\` (oldest: ${result.oldest}, newest: ${result.newest}).${repointNote}${skippedNote}`,
          }],
        };
      } catch (err: unknown) {
        return handleToolError(err, "archive_sessions");
      }
    }
  );
}
