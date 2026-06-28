import fs from "node:fs/promises";
import path from "node:path";
import { parseNote } from "./frontmatter.js";
import type { VaultManager } from "./vault-manager.js";

const PROPOSALS_DIR = "proposals/brief-updates";

export interface ProposalEdit {
  /** The `## Section` heading (without the `## `) to edit. */
  section: string;
  /** `replace` swaps the section body; `append` adds to the end of it. */
  action: "replace" | "append";
  /** Markdown content to write. */
  content: string;
}

export interface ApplicableProposal {
  path: string;
  targetBrief: string;
  confidence: string | null;
  editCount: number;
}

export interface ApplyResult {
  briefPath: string;
  sectionsChanged: string[];
  lastReviewed: string;
}

/** Heading level of a line (1 or 2), or 0 if not an H1/H2 heading. */
function headingLevel(line: string): number {
  const m = line.match(/^(#{1,2})\s+/);
  return m ? m[1].length : 0;
}

/**
 * Apply structured section edits to a markdown body. Sections are delimited
 * by `## ` headings (an H1 or H2 ends the preceding section). `replace` swaps
 * a section's body (heading preserved); `append` adds before the next heading.
 * Appending to a missing section creates it at the end; replacing a missing
 * section throws (surfaces drift rather than guessing). Pure — no I/O.
 */
export function applySectionEdits(
  body: string,
  edits: ProposalEdit[]
): { body: string; changed: string[] } {
  let lines = body.split("\n");
  const changed: string[] = [];

  for (const edit of edits) {
    const target = edit.section.trim().toLowerCase();

    let headingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^##\s+(.+?)\s*$/);
      if (m && m[1].trim().toLowerCase() === target) {
        headingIdx = i;
        break;
      }
    }

    if (headingIdx === -1) {
      if (edit.action === "replace") {
        throw new Error(`Cannot replace missing section "${edit.section}"`);
      }
      // append → create the section at the end of the note
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", `## ${edit.section}`, "", ...edit.content.split("\n"));
      changed.push(edit.section);
      continue;
    }

    // Section spans (headingIdx, next H1/H2 or EOF).
    let endIdx = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (headingLevel(lines[i]) >= 1) {
        endIdx = i;
        break;
      }
    }

    if (edit.action === "replace") {
      const newSection = edit.content.split("\n");
      const tail = lines.slice(endIdx);
      const sep = endIdx < lines.length ? [""] : [];
      lines = [...lines.slice(0, headingIdx + 1), ...newSection, ...sep, ...tail];
    } else {
      let insertAt = endIdx;
      while (insertAt - 1 > headingIdx && lines[insertAt - 1].trim() === "") {
        insertAt--;
      }
      const newLines = edit.content.split("\n");
      lines = [...lines.slice(0, insertAt), ...newLines, ...lines.slice(insertAt)];
    }
    changed.push(edit.section);
  }

  return { body: lines.join("\n"), changed };
}

/** Validate + normalize the `edits` frontmatter into ProposalEdit[]. */
export function parseEdits(frontmatter: Record<string, unknown>): ProposalEdit[] {
  const raw = frontmatter.edits;
  if (!Array.isArray(raw)) return [];
  const out: ProposalEdit[] = [];
  for (const e of raw) {
    if (
      e &&
      typeof e === "object" &&
      typeof (e as ProposalEdit).section === "string" &&
      ((e as ProposalEdit).action === "replace" ||
        (e as ProposalEdit).action === "append") &&
      typeof (e as ProposalEdit).content === "string"
    ) {
      const edit = e as ProposalEdit;
      out.push({
        section: edit.section,
        action: edit.action,
        content: edit.content,
      });
    }
  }
  return out;
}

/**
 * List proposals that can be applied deterministically: status `proposed`,
 * a `target_brief`, and at least one structured edit. Optionally filter by
 * confidence (e.g. `high`). Read-only.
 */
export async function findApplicableProposals(
  vaultRoot: string,
  options: { confidence?: string } = {}
): Promise<ApplicableProposal[]> {
  const dir = path.join(vaultRoot, PROPOSALS_DIR);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: ApplicableProposal[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const rel = `${PROPOSALS_DIR}/${entry.name}`;
    try {
      const raw = await fs.readFile(path.join(dir, entry.name), "utf-8");
      const { frontmatter } = parseNote(raw);
      if (frontmatter.status !== "proposed") continue;
      if (typeof frontmatter.target_brief !== "string") continue;
      const edits = parseEdits(frontmatter);
      if (edits.length === 0) continue;
      if (options.confidence && frontmatter.confidence !== options.confidence) {
        continue;
      }
      out.push({
        path: rel,
        targetBrief: frontmatter.target_brief.replace(/^\.\//, ""),
        confidence:
          typeof frontmatter.confidence === "string"
            ? frontmatter.confidence
            : null,
        editCount: edits.length,
      });
    } catch {
      // skip unreadable
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Apply a structured brief-update proposal: edit the target brief's sections,
 * stamp the brief's `last_reviewed`, flip the proposal to `status: applied`,
 * and record an Applied note. Goes through VaultManager so writes auto-commit
 * when git is enabled. Throws if the proposal isn't `proposed` or has no
 * structured edits (prose-only proposals must be applied manually).
 */
export async function applyProposal(
  vault: VaultManager,
  proposalPath: string,
  options: { today?: string } = {}
): Promise<ApplyResult> {
  const proposal = await vault.read(proposalPath);

  if (proposal.frontmatter.status !== "proposed") {
    throw new Error(
      `Proposal ${proposalPath} is not in 'proposed' status (status: ${String(
        proposal.frontmatter.status
      )})`
    );
  }

  const targetBrief = proposal.frontmatter.target_brief;
  if (typeof targetBrief !== "string" || !targetBrief.trim()) {
    throw new Error(`Proposal ${proposalPath} has no target_brief`);
  }
  const briefPath = targetBrief.replace(/^\.\//, "");

  const edits = parseEdits(proposal.frontmatter);
  if (edits.length === 0) {
    throw new Error(
      `Proposal ${proposalPath} has no structured edits — apply manually.`
    );
  }

  const brief = await vault.read(briefPath);
  const { body, changed } = applySectionEdits(brief.content, edits);
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  await vault.update(briefPath, {
    content: body,
    mode: "replace",
    frontmatter: { last_reviewed: today },
  });

  await vault.update(proposalPath, {
    append: `## Applied\n\n${today}: applied ${changed.length} section edit(s) to \`${briefPath}\` (${changed.join(
      ", "
    )}).`,
    frontmatter: { status: "applied", applied: today },
  });

  return { briefPath, sectionsChanged: changed, lastReviewed: today };
}
