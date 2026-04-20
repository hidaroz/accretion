import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { handleToolError } from "../utils/errors.js";

export function registerSearchByTag(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "search_by_tag",
    {
      description:
        "Find all notes with a specific tag in the Obsidian vault. Returns note paths, titles, and modification dates.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        tag: z.string().describe("Tag to search for (without # prefix)"),
        folder: z
          .string()
          .optional()
          .describe("Restrict results to notes in this folder"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, tag, folder }) => {
      try {
        const ctx = registry.resolve(vaultId);
        let notePaths = ctx.tagIndex.getNotesByTag(tag);

        if (folder) {
          const prefix = folder.endsWith("/") ? folder : folder + "/";
          notePaths = notePaths.filter((p) => p.startsWith(prefix));
        }

        if (notePaths.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No notes found with tag '${tag}'${folder ? ` in folder '${folder}'` : ""}.`,
              },
            ],
          };
        }

        const notes = await Promise.all(
          notePaths.map(async (p) => {
            try {
              const note = await ctx.vault.read(p);
              return {
                path: note.path,
                title: note.title,
                tags: note.tags,
                modifiedAt: note.modifiedAt,
              };
            } catch {
              return null;
            }
          })
        );

        const validNotes = notes
          .filter((n): n is NonNullable<typeof n> => n !== null)
          .sort(
            (a, b) =>
              new Date(b.modifiedAt).getTime() -
              new Date(a.modifiedAt).getTime()
          );

        const lines = validNotes.map(
          (n) =>
            `- **${n.title}** — \`${n.path}\` (${n.modifiedAt.split("T")[0]})${n.tags.length > 1 ? `\n  Other tags: ${n.tags.filter((t) => t !== tag.toLowerCase()).join(", ")}` : ""}`
        );

        return {
          content: [
            {
              type: "text",
              text: `## Notes tagged '${tag}' (${validNotes.length})\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "search_by_tag");
      }
    }
  );
}
