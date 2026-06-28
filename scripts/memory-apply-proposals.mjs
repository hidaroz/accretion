#!/usr/bin/env node

/**
 * Apply structured brief-update proposals (proposals/brief-updates/*.md with
 * an `edits:` block). Default is a dry-run that lists what would be applied;
 * pass --apply to actually edit briefs. Filter with --confidence high to
 * apply only high-confidence proposals (used by the autonomous weekly loop).
 *
 * Prose-only proposals (no `edits:` block) are skipped — they must be applied
 * with judgment by the LLM, not mechanically.
 *
 * Usage:
 *   node scripts/memory-apply-proposals.mjs [--vault work] [--confidence high] [--apply]
 *
 * Requires `npm run build` (imports compiled dist/). Does NOT commit — the
 * caller (memory-weekly) commits the whole run at the end.
 */

import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import {
  findApplicableProposals,
  applyProposal,
} from "../dist/vault/proposal-apply.js";
import { VaultManager } from "../dist/vault/vault-manager.js";

const args = parseArgs(process.argv.slice(2));

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const confidence =
    typeof args.confidence === "string" ? args.confidence : undefined;
  const apply = args.apply === true;

  const candidates = await findApplicableProposals(vaultRoot, { confidence });

  if (!apply) {
    console.log(
      JSON.stringify(
        { dryRun: true, count: candidates.length, candidates },
        null,
        2
      )
    );
    process.exit(0);
  }

  const vault = new VaultManager(vaultRoot, { gitAutoCommit: false });
  const results = [];
  for (const c of candidates) {
    try {
      const r = await applyProposal(vault, c.path);
      results.push({ proposal: c.path, ok: true, ...r });
    } catch (err) {
      results.push({
        proposal: c.path,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        applied: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      },
      null,
      2
    )
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
