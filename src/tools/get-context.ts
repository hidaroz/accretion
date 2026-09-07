import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultRegistry } from "../engine/registry.js";
import { assembleContext, DEFAULT_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS } from "../engine/context/assemble.js";
import { logger } from "../engine/utils/logger.js";
import { handleToolError } from "../engine/utils/errors.js";

export function registerGetContext(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "get_context",
    {
      description:
        "Assemble context from multiple domain briefs in a single call. Provide an array of topic keywords and get all relevant briefs concatenated. Reduces multiple MCP round-trips to one. Brief maps are vault-specific.",
      inputSchema: {
        vault: z.string().optional().describe("Vault ID (e.g., 'work'). Omit for default vault. Use list_vaults to see available vaults."),
        topics: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe(
            "Array of topic keywords (e.g., ['roasting', 'cycling'])"
          ),
        max_tokens: z
          .coerce.number()
          .int()
          .min(1000)
          .max(MAX_CONTEXT_TOKENS)
          .optional()
          .default(DEFAULT_CONTEXT_TOKENS)
          .describe(
            "Approximate max output size in tokens (default 8000, max 20000). Each token ≈ 4 chars."
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ vault: vaultId, topics, max_tokens }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const result = await assembleContext(ctx.vault, ctx.briefMap, ctx.searchIndex, topics, {
          maxTokens: max_tokens,
        });

        logger.info("get_context assembled context", {
          topics,
          resolved: result.resolved.length,
          notFound: result.notFound.length,
          totalChars: result.totalChars,
          vault: ctx.id,
        });

        if (result.text.trim().length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No briefs found for topics: ${topics.join(", ")}. Try \`search_notes\` instead.`,
              },
            ],
          };
        }

        return { content: [{ type: "text" as const, text: result.text }] };
      } catch (err: unknown) {
        return handleToolError(err, "get_context");
      }
    }
  );
}
