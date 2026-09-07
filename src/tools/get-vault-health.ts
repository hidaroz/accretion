import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import { runGarden, GARDEN_RULES, type GardenRule } from "../engine/lifecycle/garden.js";
import { handleToolError } from "../engine/utils/errors.js";

export function registerGetVaultHealth(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "get_vault_health",
    {
      description:
        "Structural health of a knowledge-base vault as named lint rules: orphan, missing-link, missing-page, stale-reference, missing-provenance. Read-only; powers the weekly gardening step.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID. Omit for default vault."),
        rules: z
          .array(z.enum(Object.keys(GARDEN_RULES) as [GardenRule, ...GardenRule[]]))
          .optional()
          .describe("Which rules to run (default: all)."),
        threshold: z.coerce.number().int().min(1).optional().default(3)
          .describe("Min notes for a topic cluster to be a missing-page candidate."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ vault: vaultId, rules, threshold }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const result = await runGarden(ctx.vault.root, { rules, threshold });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return handleToolError(err, "get_vault_health");
      }
    }
  );
}
