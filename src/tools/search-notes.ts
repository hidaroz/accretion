import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import { handleToolError } from "../engine/utils/errors.js";

export function registerSearchNotes(server: McpServer, registry: VaultRegistry): void {
  server.registerTool(
    "search_notes",
    {
      description:
        "Full-text search across all notes in the Obsidian vault. Returns ranked results with titles, snippets, and relevance scores. Supports optional folder and tag filtering.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        query: z.string().describe("Search terms to find in notes"),
        folder: z
          .string()
          .optional()
          .describe("Restrict search to notes in this folder (e.g., 'Specs')"),
        tag: z
          .string()
          .optional()
          .describe("Filter results to notes with this tag"),
        limit: z
          .coerce.number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Maximum number of results (default 10, max 50)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, query, folder, tag, limit }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const results = ctx.searchIndex.search(query, { folder, tag, limit });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No results found for "${query}"${folder ? ` in folder '${folder}'` : ""}${tag ? ` with tag '${tag}'` : ""}.`,
              },
            ],
          };
        }

        ctx.analytics.log({
          timestamp: new Date().toISOString(),
          tool: "search_notes",
          query,
          vault: ctx.id,
          resultCount: results.length,
          topPaths: results.slice(0, 3).map((r) => r.path),
        });

        const lines = results.map(
          (r, i) =>
            `${i + 1}. **${r.title}** (score: ${r.score.toFixed(1)})\n   Path: \`${r.path}\`${r.tags.length > 0 ? `\n   Tags: ${r.tags.join(", ")}` : ""}\n   > ${r.snippet}`
        );

        return {
          content: [
            {
              type: "text",
              text: `## Search Results for "${query}" (${results.length})\n\n${lines.join("\n\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "search_notes");
      }
    }
  );
}
