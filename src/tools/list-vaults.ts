import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { handleToolError } from "../utils/errors.js";

export function registerListVaults(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "list_vaults",
    {
      description:
        "List all registered Obsidian vaults with their IDs, display names, note counts, and readiness status. Use the returned vault IDs in other tool calls.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      try {
        const vaults = registry.list();
        const defaultId = registry.defaultId;

        const lines = vaults.map((ctx) => {
          const badge = ctx.id === defaultId ? " (default)" : "";
          const status = ctx.ready
            ? `${ctx.searchIndex.size} notes`
            : ctx.initError
              ? `error: ${ctx.initError}`
              : "initializing...";

          return `- **${ctx.displayName}** — id: \`${ctx.id}\`${badge} — ${status}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `## Available Vaults (${vaults.length})\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "list_vaults");
      }
    }
  );
}
