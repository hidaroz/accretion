import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { logger } from "../utils/logger.js";
import { handleToolError } from "../utils/errors.js";

export function registerGetBrief(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "get_brief",
    {
      description:
        "Get an agent-optimized domain brief by topic keyword. Maps common topics (roasting, cycling, auth, etc.) to the correct brief note and returns its full content. Falls back to search if no exact match. Brief maps are vault-specific.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        topic: z
          .string()
          .describe(
            "Topic keyword (e.g., 'roasting', 'cycling', 'auth', 'schema', 'mobile', 'observability')"
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, topic }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const normalized = topic.toLowerCase().trim();
        const briefPath = ctx.briefMap[normalized];

        if (briefPath) {
          const note = await ctx.vault.read(briefPath);
          logger.info("get_brief resolved topic to brief", {
            topic: normalized,
            path: briefPath,
            vault: ctx.id,
          });
          ctx.analytics.log({
            timestamp: new Date().toISOString(),
            tool: "get_brief",
            query: normalized,
            vault: ctx.id,
            resultCount: 1,
            topPaths: [briefPath],
            resolution: "direct_map",
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `# ${note.title}\n\n${note.content}`,
              },
            ],
          };
        }

        const results = ctx.searchIndex.search(normalized, {
          tag: "type/brief",
          limit: 1,
        });

        if (results.length > 0) {
          const note = await ctx.vault.read(results[0].path);
          logger.info("get_brief resolved topic via search", {
            topic: normalized,
            path: results[0].path,
            vault: ctx.id,
          });
          ctx.analytics.log({
            timestamp: new Date().toISOString(),
            tool: "get_brief",
            query: normalized,
            vault: ctx.id,
            resultCount: 1,
            topPaths: [results[0].path],
            resolution: "tag_search",
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `# ${note.title}\n\n${note.content}`,
              },
            ],
          };
        }

        const allResults = ctx.searchIndex.search(normalized, { limit: 3 });
        ctx.analytics.log({
          timestamp: new Date().toISOString(),
          tool: "get_brief",
          query: normalized,
          vault: ctx.id,
          resultCount: allResults.length,
          topPaths: allResults.map((r) => r.path),
          resolution: allResults.length > 0 ? "general_search" : "not_found",
        });

        if (allResults.length > 0) {
          const lines = allResults.map(
            (r, i) =>
              `${i + 1}. **${r.title}** — \`${r.path}\`\n   > ${r.snippet}`
          );
          return {
            content: [
              {
                type: "text" as const,
                text: `No domain brief found for "${topic}". Related notes:\n\n${lines.join("\n\n")}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `No brief or related notes found for "${topic}".`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "get_brief");
      }
    }
  );
}
