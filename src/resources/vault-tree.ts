import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultManager } from "../vault/vault-manager.js";

export function registerVaultTree(server: McpServer, vault: VaultManager): void {
  server.registerResource(
    "vault-tree",
    "obsidian://vault/tree",
    {
      description: "The complete folder and file tree of the Obsidian vault",
      mimeType: "application/json",
    },
    async (uri) => {
      const tree = await vault.getFolderTree();
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
