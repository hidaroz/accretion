import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultManager } from "../vault/vault-manager.js";
import { SearchIndex } from "../vault/search-index.js";
import { logger } from "../utils/logger.js";
import { BRIEF_MAP } from "../constants/brief-map.js";
import { handleToolError } from "../utils/errors.js";

export function registerGetContext(
  server: McpServer,
  vault: VaultManager,
  searchIndex: SearchIndex
): void {
  server.registerTool(
    "get_context",
    {
      description:
        "Assemble context from multiple domain briefs in a single call. Provide an array of topic keywords and get all relevant briefs concatenated. Reduces multiple MCP round-trips to one.",
      inputSchema: {
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
    async ({ topics, max_tokens }) => {
      try {
        const maxChars = max_tokens * 4;
        const sections: string[] = [];
        const resolved: string[] = [];
        const notFound: string[] = [];
        let totalChars = 0;

        // Deduplicate paths (multiple topics may map to same brief)
        const seenPaths = new Set<string>();

        for (const topic of topics) {
          const normalized = topic.toLowerCase().trim();
          let briefPath = BRIEF_MAP[normalized];

          // Fallback: search briefs
          if (!briefPath) {
            const results = searchIndex.search(normalized, {
              tag: "type/brief",
              limit: 1,
            });
            if (results.length > 0) {
              briefPath = results[0].path;
            }
          }

          if (!briefPath || seenPaths.has(briefPath)) {
            if (!briefPath) notFound.push(topic);
            continue;
          }

          seenPaths.add(briefPath);

          try {
            const note = await vault.read(briefPath);
            const section = `---\n# ${note.title}\n\n${note.content}\n`;

            if (totalChars + section.length > maxChars && sections.length > 0) {
              sections.push(
                `\n---\n*[Truncated: token budget reached. Remaining topics: ${topics.slice(topics.indexOf(topic)).join(", ")}]*`
              );
              break;
            }

            sections.push(section);
            resolved.push(`${topic} → ${briefPath}`);
            totalChars += section.length;
          } catch {
            notFound.push(topic);
          }
        }

        logger.info("get_context assembled context", {
          topics,
          resolved: resolved.length,
          notFound: notFound.length,
          totalChars,
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
