import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultManager } from "../vault/vault-manager.js";
import { SearchIndex } from "../vault/search-index.js";
import { logger } from "../utils/logger.js";
import { BRIEF_MAP } from "../constants/brief-map.js";
import { handleToolError } from "../utils/errors.js";

export function registerGetBrief(
  server: McpServer,
  vault: VaultManager,
  searchIndex: SearchIndex
): void {
  server.registerTool(
    "get_brief",
    {
      description:
        "Get an agent-optimized domain brief by topic keyword. Maps common topics (roasting, cycling, auth, etc.) to the correct brief note and returns its full content. Falls back to search if no exact match.",
      inputSchema: {
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
    async ({ topic }) => {
      try {
        const normalized = topic.toLowerCase().trim();
        const briefPath = BRIEF_MAP[normalized];

        if (briefPath) {
          const note = await vault.read(briefPath);
          logger.info("get_brief resolved topic to brief", {
            topic: normalized,
            path: briefPath,
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

        // Fallback: search for the topic
        const results = searchIndex.search(normalized, {
          tag: "type/brief",
          limit: 1,
        });

        if (results.length > 0) {
          const note = await vault.read(results[0].path);
          logger.info("get_brief resolved topic via search", {
            topic: normalized,
            path: results[0].path,
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

        // No brief found — search all notes
        const allResults = searchIndex.search(normalized, { limit: 3 });
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
