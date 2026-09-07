import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import { handleToolError } from "../engine/utils/errors.js";

export function registerSemanticSearch(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "semantic_search",
    {
      description:
        "Semantic (embedding) search over note sections — finds conceptually relevant content even when the exact keywords don't appear. Complements search_notes (keyword/fuzzy); use this for 'how does X work' / concept questions. Returns ranked section chunks with path, heading, snippet, and similarity score. Embeddings are local; results may be empty for a short time after server start while the index builds in the background.",
      inputSchema: {
        vault: z
          .string()
          .optional()
          .describe("Vault ID. Omit for default vault."),
        query: z.string().describe("Natural-language query."),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .default(8)
          .describe("Max results (default 8)."),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ vault: vaultId, query, limit }) => {
      try {
        const ctx = registry.resolve(vaultId);
        if (!ctx.embeddingIndex) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "semantic search is disabled (DISABLE_EMBEDDINGS)",
                    results: [],
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        const results = await ctx.embeddingIndex.search(query, limit);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: results.length, results }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "semantic_search");
      }
    }
  );
}
