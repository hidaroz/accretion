import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { stringifyNote } from "../vault/frontmatter.js";

export function registerNoteResource(server: McpServer, registry: VaultRegistry): void {
  for (const ctx of registry.list()) {
    server.registerResource(
      `note-${ctx.id}`,
      new ResourceTemplate(`obsidian://${ctx.id}/note/{+path}`, {
        list: async () => {
          const notes = ctx.searchIndex.listNotes("", true, 500);
          return {
            resources: notes.map((n) => ({
              uri: `obsidian://${ctx.id}/note/${n.path}`,
              name: n.title,
              mimeType: "text/markdown" as const,
            })),
          };
        },
      }),
      {
        description: `Read a note from the "${ctx.displayName}" vault by path`,
        mimeType: "text/markdown",
      },
      async (uri, variables) => {
        const notePath = variables.path as string;
        const note = await ctx.vault.read(notePath);

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: stringifyNote(note.content, note.frontmatter),
            },
          ],
        };
      }
    );
  }
}
