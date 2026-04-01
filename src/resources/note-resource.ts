import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultManager } from "../vault/vault-manager.js";
import { stringifyNote } from "../vault/frontmatter.js";

export function registerNoteResource(server: McpServer, vault: VaultManager): void {
  server.registerResource(
    "note",
    new ResourceTemplate("obsidian://note/{+path}", {
      list: async () => {
        const notes = await vault.list("", true, 500);
        return {
          resources: notes.map((n) => ({
            uri: `obsidian://note/${n.path}`,
            name: n.title,
            mimeType: "text/markdown" as const,
          })),
        };
      },
    }),
    {
      description: "Read an individual note from the Obsidian vault by path",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const notePath = variables.path as string;
      const note = await vault.read(notePath);

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
