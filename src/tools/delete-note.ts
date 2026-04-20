import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { handleToolError } from "../utils/errors.js";

export function registerDeleteNote(server: McpServer, registry: VaultRegistry): void {
  server.registerTool(
    "delete_note",
    {
      description:
        "Delete a note from the Obsidian vault. Requires explicit confirmation. Empty parent folders are cleaned up automatically.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        path: z.string().describe("Relative path of the note to delete"),
        confirm: z
          .coerce.boolean()
          .describe("Must be set to true to confirm deletion. Safety gate to prevent accidental deletions."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ vault: vaultId, path: notePath, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: "Deletion cancelled. Set 'confirm' to true to delete the note.",
            },
          ],
        };
      }

      try {
        const ctx = registry.resolve(vaultId);
        await ctx.vault.delete(notePath);
        return {
          content: [
            {
              type: "text",
              text: `Note deleted: \`${notePath}\``,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "delete_note");
      }
    }
  );
}
