import { z } from "zod";
import { defineCommand, vaultFlag } from "../spec.js";
import { openVault } from "../../engine/index.js";
import { getDigestCandidates } from "../../engine/lifecycle/digest-candidates.js";
import { getStaleBriefs } from "../../engine/lifecycle/brief-staleness.js";
import { archiveSessions } from "../../engine/lifecycle/archive.js";
import { findApplicableProposals, applyProposal } from "../../engine/lifecycle/proposal-apply.js";
import { findResurfaceCandidates } from "../../engine/lifecycle/resurface-review.js";
import { runGarden, GARDEN_RULES, type GardenRule } from "../../engine/lifecycle/garden.js";
import { readLog, appendLog, formatLogLine, type LogEntry, type LogKind } from "../../engine/lifecycle/log.js";
import { buildIndexMarkdown } from "../../engine/lifecycle/index-page.js";

const rules = Object.keys(GARDEN_RULES) as [GardenRule, ...GardenRule[]];

export const digestCandidates = defineCommand({
  name: "digest-candidates",
  group: "lifecycle",
  summary: "Project+period session groups that need a digest (JSON).",
  jsonOnly: true,
  input: z.object({
    vault: vaultFlag,
    period: z.enum(["week", "month"]).default("week").describe("Grouping period."),
    project: z.string().optional().describe("Only this project slug."),
    "min-sessions": z.coerce.number().int().min(1).default(1).describe("Minimum sessions per group."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return getDigestCandidates(v.vault.root, { period: args.period, project: args.project, minSessions: args["min-sessions"] });
  },
});

export const staleBriefs = defineCommand({
  name: "stale-briefs",
  group: "lifecycle",
  summary: "Briefs unreviewed for N days with related session activity since (JSON).",
  jsonOnly: true,
  input: z.object({
    vault: vaultFlag,
    "stale-days": z.coerce.number().int().min(0).default(21).describe("Days without review before a brief counts as stale."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return getStaleBriefs(v.vault.root, { staleDays: args["stale-days"] });
  },
});

export const archive = defineCommand({
  name: "archive",
  group: "lifecycle",
  summary: "Move digest-covered sessions older than N days to sessions/archive/ (dry run by default).",
  jsonOnly: true,
  input: z.object({
    vault: vaultFlag,
    days: z.coerce.number().int().min(0).default(30).describe("Archive sessions older than this many days."),
    "require-digest": z.boolean().default(true).describe("Only archive sessions a digest lists in `sources` (--no-require-digest to lift)."),
    apply: z.boolean().optional().describe("Move files. Without it, report only."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return archiveSessions(v.vault.root, { daysOld: args.days, requireDigest: args["require-digest"], apply: args.apply === true });
  },
});

export const applyProposals = defineCommand({
  name: "apply-proposals",
  group: "lifecycle",
  summary: "Apply reviewed structured proposals to their briefs (dry run by default).",
  description:
    "Human-driven. Lists proposals with status: proposed and an `edits:` block; with --apply, edits the target briefs, stamps last_reviewed, flips each proposal to applied, and logs it. Prose-only proposals are skipped. Never part of the unattended weekly run.",
  jsonOnly: true,
  input: z.object({
    vault: vaultFlag,
    confidence: z.string().optional().describe("Only proposals with this confidence value."),
    apply: z.boolean().optional().describe("Actually apply. Without it, list only."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    const candidates = await findApplicableProposals(v.vault.root, { confidence: args.confidence });
    if (!args.apply) return { dryRun: true, count: candidates.length, candidates };
    const results = [];
    for (const c of candidates) {
      try {
        const r = await applyProposal(v.vault, c.path);
        results.push({ proposal: c.path, ok: true, ...r });
      } catch (err) {
        results.push({ proposal: c.path, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  },
});

export const resurface = defineCommand({
  name: "resurface",
  group: "lifecycle",
  summary: "Spaced-review queue: evergreen notes past the review window (JSON).",
  jsonOnly: true,
  input: z.object({
    vault: vaultFlag,
    window: z.coerce.number().int().min(1).default(14).describe("Days since last review before a note is due."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return findResurfaceCandidates(v.vault.root, { window: args.window });
  },
});

export const garden = defineCommand({
  name: "garden",
  group: "lifecycle",
  summary: "Structural lints by rule: orphan, missing-link, missing-page, stale-reference, missing-provenance (JSON).",
  jsonOnly: true,
  input: z.object({
    vault: vaultFlag,
    rules: z.array(z.enum(rules)).optional().describe("Subset of rules to run."),
    threshold: z.coerce.number().int().min(1).default(3).describe("Min notes for a topic cluster to be a missing-page candidate."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return runGarden(v.vault.root, { rules: args.rules, threshold: args.threshold });
  },
});

export const log = defineCommand({
  name: "log",
  group: "lifecycle",
  summary: "Tail the vault event log (00-Index/log.md).",
  input: z.object({
    vault: vaultFlag,
    last: z.coerce.number().int().min(1).default(10).describe("How many entries."),
    kind: z.enum(["capture", "digest", "proposal", "applied", "archive", "index"]).optional().describe("Only this kind."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return readLog(v.vault.root, { last: args.last, kind: args.kind as LogKind | undefined });
  },
  format(result) {
    const entries = result as LogEntry[];
    return entries.length ? entries.map(formatLogLine).join("\n") : "(log is empty)";
  },
});

export const index = defineCommand({
  name: "index",
  group: "lifecycle",
  summary: "Regenerate 00-Index/index.md: one line per curated note.",
  input: z.object({
    vault: vaultFlag,
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    const notes = v.searchIndex
      .listNotes("", true, 100000)
      .map((n) => ({ ...n, ...(v.searchIndex.getDoc(n.path) ?? { title: n.title, content: "", tags: n.tags }) }))
      .map((n) => ({ path: n.path, title: n.title, tags: n.tags, content: n.content }));
    const md = buildIndexMarkdown(notes, { title: `${v.config.displayName} index` });
    const rel = "00-Index/index.md";
    try {
      await v.vault.update(rel, { content: md.replace(/^---[\s\S]*?---\n\n/, ""), frontmatter: { title: `${v.config.displayName} index`, tags: ["type/index"], updated: new Date().toISOString().slice(0, 10) } });
    } catch {
      await v.vault.create(rel, md);
    }
    await appendLog(v.vault.root, { kind: "index", title: `index regenerated (${notes.length} notes scanned)`, path: rel });
    return { path: rel, notes: notes.length };
  },
  format(result) {
    const r = result as { path: string; notes: number };
    return `Wrote ${r.path} (${r.notes} notes scanned).`;
  },
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "proposal";
}

export const propose = defineCommand({
  name: "propose",
  group: "lifecycle",
  summary: "File an answer or a brief change back into the vault as a proposal.",
  description:
    "Write a proposal note under proposals/. With --target it is a brief-update proposal a human can review and apply; without, a candidate new note. Body from --body or stdin. Provenance (--source, repeatable) is required so the proposal points home.",
  mcp: true,
  input: z.object({
    vault: vaultFlag,
    title: z.string().min(1).describe("Short title."),
    target: z.string().optional().describe("Vault-relative path of the brief this proposes to change."),
    confidence: z.enum(["low", "medium", "high"]).optional().describe("Triage hint, not a trigger."),
    source: z.array(z.string()).min(1).describe("Where this came from: session paths, commit shas, URLs. Repeat or comma-separate."),
    body: z.string().optional().describe("Markdown body. Omit to read from stdin."),
    "from-stdin": z.boolean().optional().describe("Read the body from stdin."),
  }),
  async run(args, ctx) {
    const body = (args.body ?? (await ctx.stdin())).trim();
    if (!body) throw new Error("proposal body is empty (pass --body or pipe it on stdin)");
    const v = await openVault({ vaultId: args.vault, semantic: false });
    const date = new Date().toISOString().slice(0, 10);
    const dir = args.target ? "proposals/brief-updates" : "proposals/notes";
    const rel = `${dir}/${date}-${slugify(args.title)}.md`;
    const fm: Record<string, unknown> = {
      title: args.title,
      status: "proposed",
      tags: ["type/proposal"],
      created: new Date().toISOString(),
      generated_by: "accretion propose",
      sources: args.source,
      ...(args.target ? { target_brief: args.target } : { kind: "new-note" }),
      ...(args.confidence ? { confidence: args.confidence } : {}),
    };
    const content = [
      `# ${args.title}`,
      "",
      args.target ? `Proposed change to \`${args.target}\`. Review, then apply with \`accretion apply-proposals --apply\` if it carries an \`edits:\` block, or by hand.` : "Candidate new note. Review, then move it to its home folder with frontmatter copied from a sibling.",
      "",
      "## Proposal",
      "",
      body,
      "",
      "## Provenance",
      "",
      ...args.source.map((s) => `- ${s}`),
      "",
    ].join("\n");
    const info = await v.vault.create(rel, content, fm);
    await appendLog(v.vault.root, { kind: "proposal", title: args.title, path: info.path });
    return { path: info.path, target: args.target ?? null };
  },
  format(result) {
    const r = result as { path: string };
    return `Wrote ${r.path}.`;
  },
});
