import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import { handleToolError } from "../engine/utils/errors.js";

export function registerReadNote(server: McpServer, registry: VaultRegistry): void {
  server.registerTool(
    "read_note",
    {
      description: "Read a note from the Obsidian vault by its relative path. Returns the full markdown content, YAML frontmatter, and file metadata.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        path: z.string().describe("Relative path from vault root (e.g., 'Meeting Notes/2024-03-20.md')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, path: notePath }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const note = await ctx.vault.read(notePath);

        const output = [
          `# ${note.title}`,
          "",
          `**Path:** ${note.path}`,
          `**Modified:** ${note.modifiedAt}`,
          `**Size:** ${note.size} bytes`,
          note.tags.length > 0 ? `**Tags:** ${note.tags.join(", ")}` : "",
          "",
          "## Frontmatter",
          "```yaml",
          JSON.stringify(note.frontmatter, null, 2),
          "```",
          "",
          "## Content",
          note.content,
        ]
          .filter(Boolean)
          .join("\n");

        return { content: [{ type: "text", text: output }] };
      } catch (err: unknown) {
        return handleToolError(err, "read_note");
      }
    }
  );
}
