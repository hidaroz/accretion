import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";

export function registerVaultTree(server: McpServer, registry: VaultRegistry): void {
  for (const ctx of registry.list()) {
    server.registerResource(
      `vault-tree-${ctx.id}`,
      `obsidian://${ctx.id}/tree`,
      {
        description: `Folder/file tree of the "${ctx.displayName}" vault`,
        mimeType: "application/json",
      },
      async (uri) => {
        const tree = await ctx.vault.getFolderTree();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(tree, null, 2),
            },
          ],
        };
      }
    );
  }
}
