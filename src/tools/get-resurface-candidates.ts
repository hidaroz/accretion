import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { findResurfaceCandidates } from "../vault/resurface-review.js";
import { handleToolError } from "../utils/errors.js";

export function registerGetResurfaceCandidates(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "get_resurface_candidates",
    {
      description:
        "Spaced-review queue for a vault: evergreen notes (type/note) whose time since last review (frontmatter last_reviewed, else authored date) exceeds the window, most overdue first. Read-only; the 'come back and understand deeply' surface.",
      inputSchema: {
        vault: z
          .string()
          .optional()
          .describe("Vault ID. Omit for default vault."),
        window: z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .default(14)
          .describe("Days since last review before a note is due (default 14)."),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ vault: vaultId, window }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const result = await findResurfaceCandidates(ctx.vault.root, { window });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "get_resurface_candidates");
      }
    }
  );
}
