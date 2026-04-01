import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultManager } from "../vault/vault-manager.js";
import { handleToolError } from "../utils/errors.js";

export function registerCreateNote(server: McpServer, vault: VaultManager): void {
  server.registerTool(
    "create_note",
    {
      description: "Create a new markdown note in the Obsidian vault. Specify a relative path (folders will be created automatically). Fails if the note already exists.",
      inputSchema: {
        path: z.string().describe("Relative path for the new note (e.g., 'Tasks/implement-auth.md'). .md extension is added if missing."),
        content: z.string().describe("Markdown body content of the note"),
        title: z.string().optional().describe("Title for the frontmatter. Defaults to filename."),
        tags: z.array(z.string()).optional().describe("Tags to add in frontmatter (e.g., ['task', 'priority-high'])"),
        frontmatter: z
          .record(z.unknown())
          .optional()
          .describe("Additional YAML frontmatter fields as key-value pairs"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ path: notePath, content, title, tags, frontmatter: extraFm }) => {
      try {
        const fm: Record<string, unknown> = {
          ...extraFm,
          created: new Date().toISOString(),
        };

        if (title) fm.title = title;
        if (tags && tags.length > 0) fm.tags = tags;

        const note = await vault.create(notePath, content, fm);

        return {
          content: [
            {
              type: "text",
              text: `Note created successfully.\n\n**Path:** ${note.path}\n**Title:** ${note.title}\n**Tags:** ${note.tags.join(", ") || "none"}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "create_note");
      }
    }
  );
}
