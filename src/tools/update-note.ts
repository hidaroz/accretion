import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import { handleToolError } from "../engine/utils/errors.js";

export function registerUpdateNote(server: McpServer, registry: VaultRegistry): void {
  server.registerTool(
    "update_note",
    {
      description:
        "Update an existing note in the Obsidian vault. Can replace, append, or prepend content. Can also merge new frontmatter fields into existing ones.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        path: z.string().describe("Relative path of the note to update"),
        content: z.string().optional().describe("New content to write (behavior depends on 'mode')"),
        append: z.string().optional().describe("Text to append to the end of the note (shorthand for mode='append')"),
        prepend: z.string().optional().describe("Text to prepend to the beginning of the note (shorthand for mode='prepend')"),
        frontmatter: z
          .record(z.unknown())
          .optional()
          .describe("Frontmatter fields to merge into existing frontmatter"),
        mode: z
          .enum(["replace", "append", "prepend"])
          .optional()
          .default("replace")
          .describe("How to apply the 'content' field: replace (default), append, or prepend"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, path: notePath, content, append, prepend, frontmatter, mode }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const updated = await ctx.vault.update(notePath, {
          content,
          append,
          prepend,
          frontmatter,
          mode,
        });

        return {
          content: [
            {
              type: "text",
              text: `Note updated successfully.\n\n**Path:** ${updated.path}\n**Title:** ${updated.title}\n**Tags:** ${updated.tags.join(", ") || "none"}\n**Modified:** ${updated.modifiedAt}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "update_note");
      }
    }
  );
}
