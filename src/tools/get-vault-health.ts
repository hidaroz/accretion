import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VaultRegistry } from "../vault/vault-registry.js";
import { readAllNotes } from "../vault/note-scan.js";
import { findOrphanNotes } from "../vault/orphan-detection.js";
import { validateStructure } from "../vault/structure-validation.js";
import { findNewDomainCandidates } from "../vault/domain-candidates.js";
import { handleToolError } from "../utils/errors.js";

export function registerGetVaultHealth(
  server: McpServer,
  registry: VaultRegistry
): void {
  server.registerTool(
    "get_vault_health",
    {
      description:
        "Structural health of a knowledge-base vault: orphan notes (not linked from any MOC), structure issues (MOCs missing from Home, dangling wikilinks, evergreen notes missing a Source), and new-domain candidates (topic/* clusters with no MOC). Read-only; powers the vault-gardener workflow.",
      inputSchema: {
        vault: z
          .string()
          .optional()
          .describe("Vault ID. Omit for default vault."),
        checks: z
          .array(z.enum(["orphans", "structure", "domains"]))
          .optional()
          .describe("Which checks to run (default: all three)."),
        threshold: z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .default(3)
          .describe("Min notes for a topic cluster to be a domain candidate."),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ vault: vaultId, checks, threshold }) => {
      try {
        const ctx = registry.resolve(vaultId);
        const root = ctx.vault.root;
        const notes = await readAllNotes(root);
        const run = checks ?? ["orphans", "structure", "domains"];
        const result: Record<string, unknown> = {};

        if (run.includes("orphans")) {
          result.orphans = (await findOrphanNotes(root, notes)).orphans;
        }
        if (run.includes("structure")) {
          result.structure = (await validateStructure(root, notes)).issues;
        }
        if (run.includes("domains")) {
          result.domainCandidates = (
            await findNewDomainCandidates(root, { threshold }, notes)
          ).candidates;
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err: unknown) {
        return handleToolError(err, "get_vault_health");
      }
    }
  );
}
