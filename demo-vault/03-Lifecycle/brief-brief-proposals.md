---
title: Brief proposals — propose-only, never unattended edits
tags:
  - type/brief
  - project/accretion
  - topic/proposals
created: 2026-06-19T09:00:00Z
last_reviewed: 2026-07-28
---

> TL;DR: The weekly loop may not edit brief content. It writes proposals; a human applies them. Deterministic housekeeping stays automatic. This line exists because measurement showed the alternative could not be trusted.

## The line

**Deterministic housekeeping is automatic.** Writing digests, stamping `last_reviewed`,
archiving digest-covered sessions, repointing links — all mechanical, all verifiable, all
unattended.

**Semantic edits are not.** Changing what a brief *says* is a judgment about meaning. The
loop writes a proposal to `proposals/brief-updates/` with an `edits:` block, a `status`, a
`confidence` hint, and provenance. A human applies it with `memory-apply-proposals.mjs
--apply` or the `apply_brief_proposal` tool.

`confidence` is a triage hint for the human reading the queue. It is not a trigger. Nothing
auto-applies because a model felt sure.

## Why it was removed rather than gated

An earlier design auto-applied high-confidence edits. Confidence turned out to be poorly
correlated with correctness on exactly the edits that mattered — a model is most confident
when a session restates something the brief already says, and least confident when a session
genuinely contradicts it. The gate let through the useless edits and blocked the valuable
ones.

The deeper problem is that a wrong brief edit is invisible. It does not throw. Retrieval
returns the corrupted brief with the same confidence as before, and it silently poisons
every future answer on that topic. There is no error to notice, and the source sessions may
be archived by the time anyone questions it.

If auto-apply is ever reintroduced it should run in shadow mode for several cycles first —
writing what it *would* have applied, measured against what a human actually approved —
until the false-accept rate is demonstrably near zero. Not before.

## What the edit engine can reach

`proposal-apply.ts` matches headings at any level H1–H6 for both `replace` and `append`.

The real limits:

- `replace` on a **missing** heading throws `Cannot replace missing section`. It will not
  silently create one.
- `append` to a missing heading *creates* it, always as `##`, at the **end** of the note. A
  proposal relying on placement should say so.
- Content **before the first heading** — a `> TL;DR:` line, a top callout — is unreachable.
  Those need `patch_note` and must be flagged for manual application.

A proposal targeting an unreachable region should be written anyway, marked as needing
manual application, and restated in every subsequent run report until it is done. The next
run is a fresh model that cannot remember it.

## Related

- [[brief-weekly-loop]] — what generates proposals
- [[brief-vault-structure]] — where proposals live
