import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { routeBrief } from "../vault/brief-routing.js";
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

        // Route with confidence gating: prefer "no brief" over a plausible-but-
        // wrong one (a wrong governance brief is worse than missing context).
        const route = routeBrief(ctx.briefMap, ctx.searchIndex, normalized);

        if (route.path) {
          const note = await ctx.vault.read(route.path);
          logger.info("get_brief resolved topic to brief", {
            topic: normalized,
            path: route.path,
            method: route.method,
            vault: ctx.id,
          });
          ctx.analytics.log({
            timestamp: new Date().toISOString(),
            tool: "get_brief",
            query: normalized,
            vault: ctx.id,
            resultCount: 1,
            topPaths: [route.path],
            resolution: route.method,
          });
          const caveat =
            route.method === "tag_search"
              ? " (fuzzy match — verify this is the correct brief)"
              : "";
          return {
            content: [
              {
                type: "text" as const,
                text: `# ${note.title}\n\n${note.content}\n\n---\n_Resolved via: ${route.method}${caveat}_`,
              },
            ],
          };
        }

        // Abstained — no confident brief. Offer related notes WITHOUT claiming a
        // brief, so the agent isn't handed wrong governance context.
        const allResults = ctx.searchIndex.search(normalized, { limit: 3 });
        ctx.analytics.log({
          timestamp: new Date().toISOString(),
          tool: "get_brief",
          query: normalized,
          vault: ctx.id,
          resultCount: allResults.length,
          topPaths: allResults.map((r) => r.path),
          resolution: "abstain",
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
                text: `No domain brief confidently matches "${topic}" — not routing to avoid a wrong brief. Possibly related notes (verify before relying on them):\n\n${lines.join("\n\n")}`,
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
