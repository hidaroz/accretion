import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { rrf, isRawSession } from "../vault/hybrid.js";
import { routeBrief } from "../vault/brief-routing.js";
import { handleToolError } from "../utils/errors.js";

export function registerHybridSearch(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "hybrid_search",
    {
      description:
        "Hybrid retrieval: fuses keyword (MiniSearch) and semantic (embedding) results via reciprocal-rank fusion, with raw session journals de-prioritized. Recovers both exact-term and concept matches — measurably higher recall@k and MRR than either index alone (eval-validated). Use this as the default note search for durable answers; search_notes / semantic_search remain for single-mode use.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID. Omit for default vault."),
        query: z.string().describe("Natural-language query."),
        limit: z.coerce.number().int().min(1).max(25).optional().default(8)
          .describe("Max results (default 8)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ vault: vaultId, query, limit }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const wide = limit * 3;

        const kw = ctx.searchIndex.search(query, { limit: wide });
        const sem = ctx.embeddingIndex
          ? await ctx.embeddingIndex.search(query, wide)
          : [];

        // Enrich each path with the best available title/snippet/source.
        const meta = new Map<string, { title: string; snippet: string; source: string }>();
        for (const r of kw) {
          meta.set(r.path, { title: r.title, snippet: r.snippet, source: "keyword" });
        }
        const semPaths: string[] = [];
        for (const r of sem) {
          if (!meta.has(r.path)) {
            meta.set(r.path, {
              title: r.path.split("/").pop()?.replace(/\.md$/, "") ?? r.path,
              snippet: r.snippet,
              source: "semantic",
            });
          }
          if (!semPaths.includes(r.path)) semPaths.push(r.path);
        }

        // Pin the canonical routed brief (if any) so fusion can't bury it.
        const pin = routeBrief(ctx.briefMap, ctx.searchIndex, query).path;
        const fused = rrf([kw.map((r) => r.path), semPaths], {
          weight: (p) => (isRawSession(p) ? 0.7 : 1),
          pins: pin ? [pin] : [],
        }).slice(0, limit);

        const results = fused.map((path, i) => ({
          rank: i + 1,
          path,
          title: meta.get(path)?.title ?? path,
          snippet: meta.get(path)?.snippet ?? "",
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { count: results.length, semantic: !!ctx.embeddingIndex, results },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "hybrid_search");
      }
    }
  );
}
