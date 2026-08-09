---
description: "Weekly memory curation for an Obsidian vault — digests, staleness, proposals, archive"
argument-hint: "[--vault <id>] [--autonomous] [--dry-run]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
---

# Weekly memory curation

**Arguments:** `$ARGUMENTS`

Parse `--vault <id>`, `--autonomous`, and `--dry-run`.

If `--vault` is omitted, use the vault marked `"default": true` in the registry; if none is
marked, stop and say so rather than guessing.

In `--autonomous` mode you are running headless under a scheduler with no human present:
never ask a question, never block on approval, and record anything needing judgment in the
run report instead.

**In `--dry-run` mode, write nothing.** Do every read-only step, then print the run report
to stdout instead of saving it. Skip `--apply` on archive, skip the commit, skip the push.
Say plainly at the end that nothing was written. This is the default for
`bin/memory-weekly-run.sh`; `--apply` there is what turns it off.

Run every `node scripts/…` command from the repo root. `$ACCRETION_HOME` holds its path
when the scheduler invoked you; otherwise use the checkout you are already in.

## Ground rules

**Propose only. Never edit brief content.** Brief edits are semantic judgments, and
unattended auto-apply was removed after measurement showed it could not be trusted (see
`docs/DESIGN.md` → "Review outcome"). You write proposals to `proposals/brief-updates/`; a
human applies them later with `memory-apply-proposals.mjs --apply` or
`apply_brief_proposal`. `confidence` is a triage hint, not a trigger. Deterministic
housekeeping — digests, `last_reviewed` stamps, archiving — stays automatic.

**Do not reimplement what exists.** Every step below has a script. Use it. The scheduled
wrapper's `--allowedTools` permits only `Bash(node:*)`, `Bash(git:*)`, `Bash(osascript:*)`,
`Read`, `Write`, `Edit` — the MCP tools are not available on the scheduled path, so prefer
the scripts even when running interactively, or the two paths will diverge.

**Every artifact is a message to a stranger.** The next run is a fresh model with no memory
of this one. State must be legible on disk: status flags, exact source lists, explicit
"still outstanding" notes.

## Steps

### 0. Preflight

```bash
node scripts/doctor.mjs
```

If it exits non-zero, note the failures in the report. Continue anyway unless the vault
itself is unreachable — a stale embedding index should not block digest synthesis.

### 1. Digests — the only step that needs judgment

```bash
node scripts/memory-digest-candidates.mjs --vault <id>
```

Write a digest for every group with `"exists": false`, **except the current in-progress
week** — skip it and say so; it gets picked up next run.

Output goes to `sessions/digests/{period}-{project}.md`. Match the structure of the
existing digests in that directory: frontmatter with `title`, `tags` (`type/digest`,
`project/<slug>`), `period`, `session_count`, `sources` (exact relative paths), `created`,
`generated_by`; then `> TL;DR:`, `## Summary`, `## Decisions`, `## Open Threads`,
`## Trends`, `## Source Sessions` (wikilinks with titles). If the directory is empty, this
list is the specification.

Read the actual session notes. `## Open Threads` is the section that earns this step —
work that was started and left undone, questions raised and unanswered, branches never
pushed. Do not soften it. If a session carries no substantive content, say so plainly
rather than padding.

`sources` must list the real paths — `memory-archive.mjs` reads that frontmatter to decide
what is safe to archive, so a wrong path silently strands a session forever.

### 2. Stale briefs → proposals

```bash
node scripts/memory-stale-briefs.mjs --vault <id> --stale-days 21
```

For each stale brief, read it and the sessions that matched. Then either:

- **Propose an edit** — write `proposals/brief-updates/{period}-{brief-slug}.md` with an
  `edits:` block, `status: proposed`, a `confidence` triage hint, and provenance (which
  session, what date, what changed). Only propose what the sessions actually establish.
- **Review and skip** — if the matches are routine continuation of what the brief already
  covers, or incidental keyword hits belonging to another brief, stamp `last_reviewed` on
  the brief and write no proposal. Record the reasoning in the report.

**What the edit engine can and cannot reach.** `src/vault/proposal-apply.ts` matches
`/^(#{1,6})\s+/` and captures the heading's own level, so a target at **any** level H1–H6
resolves for both `replace` and `append`.

The real limits are:
- `replace` on a **missing** heading throws `Cannot replace missing section`.
- `append` on a **missing** heading creates it, always as `## `, at the **end** of the
  note — so it can land after a trailing section. Say so in the proposal if that matters.
- Content **before the first heading** — a `> TL;DR:` line, a top-of-note callout — is
  unreachable. Those need `patch_note` and must be flagged for manual application.

### 3. Archive digest-covered sessions

```bash
node scripts/memory-archive.mjs --vault <id> --days 30            # dry run
node scripts/memory-archive.mjs --vault <id> --days 30 --apply    # skip if --dry-run
```

Never pass `--no-require-digest` on an unattended run. The digest requirement is what
guarantees nothing is archived before it has been synthesized.

### 4. Structural health

```bash
node scripts/memory-garden.mjs --vault <id>
node scripts/memory-resurface.mjs --vault <id> --window 14
```

Report orphans, structure issues, new-domain candidates, and the spaced-review queue. Do
not act on them unattended — surfacing is the job.

### 5. Run report

Write `sessions/digests/_runs/{YYYY-MM-DD}-memory-run.md` (or print it, under `--dry-run`):

```yaml
---
title: 'Memory-weekly run — {YYYY-MM-DD}'
tags:
  - type/memory-run
created: {ISO8601}
vault: {id}
mode: autonomous|manual|dry-run
---
```

Then `> TL;DR:` one line with the counts, and sections: `## Digests written`,
`## Brief proposals` (split into *Proposed*, *Reviewed and skipped*, *Needs manual
application*), `## Archived`, `## Warnings / failures`.

Under warnings, record what a future run needs to know: doctor failures, malformed dates,
tooling limits hit, and anything left for a human. **An outstanding manual TODO must be
restated in every subsequent report until it is done** — the next run cannot remember it.

### 6. Commit

Skip this entire step under `--dry-run`.

```bash
git -C <vault-path> add -A
git -C <vault-path> commit -m "memory-weekly: {N} digests, {M} proposals, {K} archived"
```

Then push **only if** the vault's `gitAutoPush` is true in `~/.config/accretion/vaults.json`
— read it, do not assume. It defaults to false, and pushing a vault the user never
nominated for a remote is not recoverable.

### 7. Notify

macOS only; skip silently elsewhere, where the log is the record.

```bash
osascript -e 'display notification "…" with title "memory-weekly ({vault})"'
```

Summarize counts, and say explicitly if anything needs a human.
