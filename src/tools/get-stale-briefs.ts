import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { getStaleBriefs } from "../vault/brief-staleness.js";
import { handleToolError } from "../utils/errors.js";

export function registerGetStaleBriefs(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "get_stale_briefs",
    {
      description:
        "List briefs not reviewed in N days that have related session activity since their review date (brief-map keyword overlap). Briefs with an open update proposal are excluded. Returns structured JSON. Read-only.",
      inputSchema: {
        vault: z
          .string()
          .optional()
          .describe("Vault ID. Omit for default vault."),
        stale_days: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .default(21)
          .describe(
            "Consider briefs stale after this many days without review (default 21)"
          ),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ vault: vaultId, stale_days }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const result = await getStaleBriefs(ctx.vault.root, {
          staleDays: stale_days,
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
        return handleToolError(err, "get_stale_briefs");
      }
    }
  );
}
