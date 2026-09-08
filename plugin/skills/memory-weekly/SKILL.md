---
name: memory-weekly
description: Weekly curation of an accretion vault: digests from sessions, stale-brief proposals, archive, lints, run report. Run by hand or by the scheduler, never triggered by conversation.
disable-model-invocation: true
allowed-tools: Bash(accretion *) Bash(osascript *) Read Write Edit Glob Grep
---

# Weekly memory curation

**Arguments:** `$ARGUMENTS`. Parse `--vault <id>`, `--autonomous`, `--dry-run`.

`accretion` is on PATH. If `--vault` is omitted, use the vault `accretion list-vaults` marks
as default; if none is marked, stop and say so.

`--autonomous`: you run headless under a scheduler with nobody present. Record anything
that needs judgment in the run report and continue.

`--dry-run`: write nothing. Do every read-only step, print the run report to stdout, skip
`--apply` on archive, skip the commit. End by saying plainly that nothing was written. The
scheduled wrapper passes this unless it was given `--apply`.

## Ground rules

**Propose, never edit brief content.** A brief edit is a semantic judgment, and a wrong one
throws no error: retrieval keeps serving it with unchanged confidence. Write proposals; a
human applies them with `accretion apply-proposals --apply`. `confidence` is a triage
hint. Deterministic housekeeping (digests, `last_reviewed` stamps, archive, the index) is
yours to do.

**Use the CLI for every step.** Each step names its command. The commands are the same
ones a person runs by hand, so the scheduled path and the interactive path cannot drift.

**Every artifact is a message to a stranger.** The next run is a fresh model with no memory
of this one. State lives on disk: status flags, exact source lists, explicit "still
outstanding" notes, and one line per event in `00-Index/log.md`.

**What earns a place in the vault.** Something an agent cannot find by looking: a
convention, a rationale, a gotcha. A decision earns a brief section only when it is hard
to reverse, surprising without context, and the result of a real trade-off. Considered and
declined belongs in a `type/rejected` note so it is not re-litigated. Describe behaviour and
interfaces; paths and line numbers go stale.

## Steps

### 0. Preflight

```bash
accretion doctor
```

Note failures in the report and continue unless the vault itself is unreachable.

### 1. Digests: the step that needs judgment

```bash
accretion digest-candidates --vault <id>
```

Write a digest for every group with `"exists": false`, except the current in-progress
week; say you skipped it. Output: `sessions/digests/{period}-{project}.md`, matching the
existing digests in that directory: frontmatter `title`, `tags` (`type/digest`,
`project/<slug>`), `period`, `session_count`, `sources` (exact relative paths), `created`,
`generated_by`; then `> TL;DR:`, `## Summary`, `## Decisions`, `## Open Threads`,
`## Trends`, `## Source Sessions` (wikilinks with titles). If the directory is empty, this
list is the specification.

Read the session notes themselves. `## Open Threads` is what this step is for: work started
and left, questions raised and unanswered, branches never pushed. A digest is lossy on
purpose; compress hard, the sessions stay on disk as the recovery path. A session with no
substance gets one honest line.

`sources` must list real paths: `accretion archive` reads them to decide what is safe to
move, so a wrong path strands a session forever.

### 2. Stale briefs become proposals

```bash
accretion stale-briefs --vault <id> --stale-days 21
```

For each stale brief, read it and the sessions that matched, then do one of:

- **Propose.** `accretion propose --vault <id> --title "<period> <brief-slug>" --target
  <brief path> --confidence <low|medium|high> --source <session path> ...` with the body on
  stdin. Where the change is a section replace or append, include an `edits:` block in the
  proposal frontmatter so `apply-proposals` can apply it mechanically:

  ```yaml
  edits:
    - section: "Why two indexes"
      action: replace | append
      content: |
        ...
  ```

  Only propose what the sessions establish. Content before the first heading (a TL;DR
  line, a callout) cannot be reached by `edits:`; say so in the proposal for manual
  application.
- **Review and skip.** Routine continuation of what the brief already says, or incidental
  keyword hits that belong to another brief: stamp `last_reviewed` on the brief (frontmatter
  only, with Edit) and record the reasoning in the report.

### 3. Contradictions and gaps

While reading in steps 1 and 2, note where a session contradicts a brief, or where a topic
recurs across sessions and no brief or playbook owns it. File each as a proposal
(`--title "contradiction: ..."` or `--title "gap: ..."`, with sources). Procedural knowledge
that recurs ("how we debug X here") is a `type/playbook` candidate; propose it as a new
note.

### 4. Archive digest-covered sessions

```bash
accretion archive --vault <id> --days 30            # report
accretion archive --vault <id> --days 30 --apply    # skip under --dry-run
```

Keep `--require-digest` on (the default) when unattended: nothing is archived before it
has been synthesised.

### 5. Structural health and resurface

```bash
accretion garden --vault <id>
accretion resurface --vault <id> --window 14
accretion index --vault <id>                        # skip under --dry-run
```

Report `garden` issues by rule (`orphan`, `missing-link`, `missing-page`,
`stale-reference`, `missing-provenance`) and the brief growth figure. For each resurfaced
note say one of **promote** (link it from a MOC, it earned it), **merge** (fold into a
sibling), or **drop** (recommend deletion). Surfacing is the job; act only on `index`.

### 6. Run report

Write `sessions/digests/_runs/{YYYY-MM-DD}-memory-run.md` (print it under `--dry-run`). If a
report for today already exists, write `{YYYY-MM-DD}-memory-run-2.md` (then `-3`, and so on)
rather than overwriting it; an earlier run's report is part of the record.

```yaml
---
title: 'Memory-weekly run: {YYYY-MM-DD}'
tags:
  - type/memory-run
created: {ISO8601}
vault: {id}
mode: autonomous|manual|dry-run
---
```

Then `> TL;DR:` with the counts, and sections `## Digests written`, `## Proposals`
(split into *Proposed*, *Reviewed and skipped*, *Needs manual application*),
`## Archived`, `## Health` (lint counts by rule, brief growth, resurface verdicts),
`## Warnings / failures`. An outstanding manual TODO is restated in every later report
until it is done.

### 7. Commit

Skip under `--dry-run`.

```bash
accretion commit --vault <id> --message "memory-weekly: {N} digests, {M} proposals, {K} archived"
```

`commit` is the only git step; it pushes only when the vault's `gitAutoPush` is true.

### 8. Notify (macOS only)

```bash
osascript -e 'display notification "…" with title "memory-weekly ({vault})"'
```

Summarise counts and say explicitly if anything needs a human.
