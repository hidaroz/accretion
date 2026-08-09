---
title: The weekly loop — autonomous curation, dry-run by default
tags:
  - type/brief
  - project/accretion
  - topic/automation
created: 2026-06-23T09:00:00Z
last_reviewed: 2026-08-01
---

> TL;DR: A scheduled headless agent digests, proposes, archives, and reports. It runs dry by default; `--apply` opts into mutation. Every run is a fresh model with no memory, so all state must be legible on disk.

## What it does

Once a week, `bin/memory-weekly-run.sh <vault>` invokes `/memory-weekly --autonomous`
headless. The agent runs preflight (`doctor.mjs`), synthesises missing digests, checks stale
briefs and writes proposals, archives digest-covered sessions, surveys structural health,
writes a run report, commits, and notifies.

## Dry run is the default

The loop spawns an agent with `Read`/`Write`/`Edit` and `Bash(node:*)`/`Bash(git:*)` against
a vault it can commit and push. That is a reasonable thing to schedule once you have watched
it work and read its reports. It is not a reasonable thing to happen to somebody the first
time they try the tool.

So it reports what it *would* do and writes nothing. `--apply` turns on mutation, and belongs
in the launchd plist only after a supervised run.

Worth being explicit: `Bash(node:*)` permits `node -e '…'`, so that allowlist is closer to
arbitrary code execution than it looks. The loop is bounded by its instructions, not by the
allowlist. That is precisely why the default is dry.

## Every run is a fresh model

The scheduled agent has no memory of previous runs. It sees only the vault on disk.

This has a specific consequence for how state is recorded: it must be self-evident. A
`status: applied` flag, a `[!done]` banner, an exact `sources:` list. Anything implicit —
anything that depends on remembering what happened last week — is invisible to the next run.

The strongest form of this rule: **an outstanding manual TODO must be restated in every
subsequent run report until it is done.** Mentioning it once and assuming it carries forward
guarantees it is forgotten.

## Silent success is the real failure mode

A run that exits 0 having quietly done nothing is worse than one that crashes. A crash gets
noticed.

This pipeline has died silently more than once — once when the capture hook vanished, once
when the scheduled agent was generated but never actually loaded. Nothing broke loudly
either time, and the gap was measured in weeks.

So the exit code is not the health signal. The postflight runs `doctor.mjs`, which knows what
"still broken" looks like: a digest backlog, a stale index, an unloaded agent. Doctor decides
whether the run counts as healthy, and a run that completes but leaves doctor red raises a
separate notification.

## Related

- [[brief-brief-proposals]] — the propose-only rule this loop obeys
- [[brief-digests-archive]] — steps 1 and 3
- [[brief-observability]] — what doctor checks and why
