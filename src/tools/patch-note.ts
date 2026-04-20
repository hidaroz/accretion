import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { handleToolError } from "../utils/errors.js";

export function registerPatchNote(server: McpServer, registry: VaultRegistry): void {
  server.registerTool(
    "patch_note",
    {
      description:
        "Apply surgical find/replace edits to a note. Each edit replaces an exact occurrence of old_string with new_string in the note body (frontmatter is untouched). Edits are applied sequentially — edit N's old_string matches against the result of edit N-1. Errors if old_string is not found, or is not unique and replace_all is false. Use update_note for bulk replace/append/prepend or frontmatter changes.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        path: z.string().describe("Relative path of the note to patch"),
        edits: z
          .array(
            z.object({
              old_string: z
                .string()
                .min(1)
                .describe(
                  "Exact text to find in the note body. Must match a unique location unless replace_all is true."
                ),
              new_string: z
                .string()
                .describe("Replacement text (may be empty to delete)."),
              replace_all: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                  "If true, replace every occurrence of old_string. If false (default), old_string must match exactly once."
                ),
            })
          )
          .min(1)
          .describe(
            "Ordered list of edits applied sequentially to the note body. All edits succeed atomically — if any edit fails, no changes are written."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, path: notePath, edits }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const updated = await ctx.vault.patch(notePath, edits);

        return {
          content: [
            {
              type: "text",
              text: `Note patched successfully.\n\n**Path:** ${updated.path}\n**Title:** ${updated.title}\n**Edits applied:** ${edits.length}\n**Modified:** ${updated.modifiedAt}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "patch_note");
      }
    }
  );
}
