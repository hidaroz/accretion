import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SearchIndex } from "../vault/search-index.js";
import { handleToolError } from "../utils/errors.js";

export function registerListNotes(server: McpServer, searchIndex: SearchIndex): void {
  server.registerTool(
    "list_notes",
    {
      description:
        "List markdown notes in the Obsidian vault, optionally filtered to a specific folder. Returns note paths, titles, tags, and modification dates sorted by most recently modified. Defaults to recursive traversal from the requested folder (or the whole vault if no folder is given).",
      inputSchema: {
        folder: z
          .string()
          .optional()
          .default("")
          .describe("Relative folder path to list (e.g., 'Meeting Notes'). Empty string for vault root."),
        recursive: z
          .coerce.boolean()
          .optional()
          .default(true)
          .describe("If true (default), include notes in subdirectories. Set false to list only the folder's immediate children."),
        limit: z
          .coerce.number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .default(100)
          .describe("Maximum number of notes to return (default 100, max 500)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ folder, recursive, limit }) => {
      try {
        const notes = searchIndex.listNotes(folder, recursive, limit);

        if (notes.length === 0) {
          const locationMsg = folder ? `in folder '${folder}'` : "in the vault";
          return {
            content: [{ type: "text", text: `No notes found ${locationMsg}.` }],
          };
        }

        const lines = notes.map(
          (n) =>
            `- **${n.title}** — \`${n.path}\` (${n.modifiedAt.split("T")[0]})${n.tags.length > 0 ? ` [${n.tags.join(", ")}]` : ""}`
        );

        const header = folder
          ? `## Notes in \`${folder}\` (${notes.length})`
          : `## All Notes (${notes.length})`;

        return {
          content: [
            { type: "text", text: `${header}\n\n${lines.join("\n")}` },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "list_notes");
      }
    }
  );
}
