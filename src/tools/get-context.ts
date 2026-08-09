import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { routeBrief } from "../vault/brief-routing.js";
import { logger } from "../utils/logger.js";
import { handleToolError } from "../utils/errors.js";

/**
 * Cut `text` to at most `limit` characters, preferring a markdown section
 * boundary so a brief ends on a whole idea rather than mid-sentence.
 *
 * Falls back to a paragraph break, then to a hard cut — a brief with no
 * headings at all should still be trimmed rather than blowing the budget.
 */
export function truncateAtSection(text: string, limit: number): string {
  if (limit <= 0) return "";
  if (text.length <= limit) return text;

  const window = text.slice(0, limit);
  // Only accept a boundary in the back half, or a brief whose first heading is
  // late would collapse to almost nothing.
  const floor = Math.floor(limit / 2);

  const heading = window.lastIndexOf("\n## ");
  if (heading > floor) return text.slice(0, heading).trimEnd();

  const para = window.lastIndexOf("\n\n");
  if (para > floor) return text.slice(0, para).trimEnd();

  return window.trimEnd();
}

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
          .max(20000)
          .optional()
          .default(8000)
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
        const maxChars = max_tokens * 4;
        const sections: string[] = [];
        const resolved: string[] = [];
        const notFound: string[] = [];
        let totalChars = 0;

        const seenPaths = new Set<string>();

        // Resolve every topic before reading anything: the budget has to be
        // divided across the briefs that actually resolved, and that count is
        // not known until routing has run for all of them.
        const routed: Array<{ topic: string; briefPath: string }> = [];
        for (const topic of topics) {
          const normalized = topic.toLowerCase().trim();
          // Confidence-gated routing — abstain rather than assemble a wrong brief.
          const briefPath = routeBrief(ctx.briefMap, ctx.searchIndex, normalized).path;

          if (!briefPath) {
            notFound.push(topic);
            continue;
          }
          if (seenPaths.has(briefPath)) continue;

          seenPaths.add(briefPath);
          routed.push({ topic, briefPath });
        }

        // Fair-share the budget instead of first-come-first-served.
        //
        // Filling one shared budget in order lets the first topic starve the
        // rest: asking for three topics returned the first brief in full and a
        // "budget reached" marker, because that brief alone was larger than the
        // default allowance. A caller naming three topics wants three topics,
        // not the first one in full.
        //
        // Each brief gets an equal share of what is left, and whatever it does
        // not use rolls forward — so small briefs subsidise large ones rather
        // than argument order deciding who gets nothing.
        for (let i = 0; i < routed.length; i++) {
          const { topic, briefPath } = routed[i];
          const allowance = Math.floor((maxChars - totalChars) / (routed.length - i));

          try {
            const note = await ctx.vault.read(briefPath);
            const header = `---\n# ${note.title}\n\n`;
            let body = note.content;

            if (header.length + body.length + 1 > allowance) {
              const notice = `\n\n*[Truncated to fit the context budget — read \`${briefPath}\` for the rest.]*`;
              body =
                truncateAtSection(
                  body,
                  Math.max(0, allowance - header.length - notice.length - 1)
                ) + notice;
            }

            sections.push(`${header}${body}\n`);
            resolved.push(`${topic} → ${briefPath}`);
            totalChars += header.length + body.length + 1;
          } catch {
            notFound.push(topic);
          }
        }

        logger.info("get_context assembled context", {
          topics,
          resolved: resolved.length,
          notFound: notFound.length,
          totalChars,
          vault: ctx.id,
        });

        let output = sections.join("\n");

        if (notFound.length > 0) {
          output += `\n\n---\n*No briefs found for: ${notFound.join(", ")}. Try \`search_notes\` for these topics.*`;
        }

        if (output.trim().length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No briefs found for topics: ${topics.join(", ")}. Try \`search_notes\` instead.`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text" as const, text: output }],
        };
      } catch (err: unknown) {
        return handleToolError(err, "get_context");
      }
    }
  );
}
