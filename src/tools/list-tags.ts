import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { handleToolError } from "../utils/errors.js";

export function registerListTags(server: McpServer, registry: VaultRegistry): void {
  server.registerTool(
    "list_tags",
    {
      description:
        "List all unique tags used across notes in the Obsidian vault, with the count of notes using each tag. Sorted by frequency.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        prefix: z
          .string()
          .optional()
          .describe("Filter to tags starting with this prefix (e.g., 'project' to find 'project-atlas', 'project-mobile')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, prefix }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const tags = ctx.tagIndex.getAllTags(prefix);

        if (tags.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: prefix
                  ? `No tags found with prefix '${prefix}'.`
                  : "No tags found in the vault.",
              },
            ],
          };
        }

        const lines = tags.map((t) => `- **${t.tag}** (${t.count} notes)`);

        return {
          content: [
            {
              type: "text",
              text: `## Tags (${tags.length})\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "list_tags");
      }
    }
  );
}
