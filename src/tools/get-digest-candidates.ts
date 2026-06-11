import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { getDigestCandidates } from "../vault/digest-candidates.js";
import { handleToolError } from "../utils/errors.js";

export function registerGetDigestCandidates(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "get_digest_candidates",
    {
      description:
        "List project+period session groups that need a digest (sessions/digests/{period}-{project}.md missing). Returns structured JSON for the /memory-weekly synthesis workflow. Read-only.",
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
        min_sessions: z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe("Minimum sessions per group (default 1)"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ vault: vaultId, period, project, min_sessions }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const result = await getDigestCandidates(ctx.vault.root, {
          period,
          project,
          minSessions: min_sessions,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "get_digest_candidates");
      }
    }
  );
}
