import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../engine/registry.js";
import { applyProposal } from "../engine/lifecycle/proposal-apply.js";
import { handleToolError } from "../engine/utils/errors.js";

export function registerApplyBriefProposal(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "apply_brief_proposal",
    {
      description:
        "Apply a structured brief-update proposal (proposals/brief-updates/*.md with a `edits:` block): edit the target brief's sections, stamp its last_reviewed, flip the proposal to status: applied, and record an Applied note. Closes the staleness loop. Errors if the proposal isn't status: proposed or has only prose changes (apply those manually). Writes auto-commit when git is enabled.",
      inputSchema: {
        vault: z
          .string()
          .optional()
          .describe("Vault ID. Omit for default vault."),
        proposal: z
          .string()
          .describe(
            "Vault-relative path to the proposal note, e.g. proposals/brief-updates/2026-W26-brief-demo.md"
          ),
        today: z
          .string()
          .optional()
          .describe(
            "Override the last_reviewed/applied date (YYYY-MM-DD). Defaults to today."
          ),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ vault: vaultId, proposal, today }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const result = await applyProposal(ctx.vault, proposal, { today });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "apply_brief_proposal");
      }
    }
  );
}
