#!/usr/bin/env node

/**
 * Print structural health findings for a knowledge-base vault, as JSON:
 * orphan notes, structure issues (MOC/Home sync, dangling links, missing
 * sources), and new-domain candidates.
 *
 * Usage:
 *   node scripts/memory-garden.mjs [--vault general] [--check orphans,structure,domains] [--threshold N]
 *
 * Requires `npm run build` (imports compiled dist/).
 */

import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { readAllNotes } from "../dist/engine/vault/note-scan.js";
import { findOrphanNotes } from "../dist/engine/lifecycle/orphan-detection.js";
import { validateStructure } from "../dist/engine/lifecycle/structure-validation.js";
import { findNewDomainCandidates } from "../dist/engine/lifecycle/domain-candidates.js";

const args = parseArgs(process.argv.slice(2));
const checks =
  typeof args.check === "string"
    ? args.check.split(",").map((s) => s.trim())
    : ["orphans", "structure", "domains"];

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const notes = await readAllNotes(vaultRoot);
  const result = {};

  if (checks.includes("orphans")) {
    result.orphans = (await findOrphanNotes(vaultRoot, notes)).orphans;
  }
  if (checks.includes("structure")) {
    result.structure = (await validateStructure(vaultRoot, notes)).issues;
  }
  if (checks.includes("domains")) {
    result.domainCandidates = (
      await findNewDomainCandidates(
        vaultRoot,
        { threshold: args.threshold ? Number(args.threshold) : 3 },
        notes
      )
    ).candidates;
  }

  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
