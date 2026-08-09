---
title: Digests and archiving — compressing sessions into memory
tags:
  - type/brief
  - project/accretion
  - topic/digests
created: 2026-06-16T09:00:00Z
last_reviewed: 2026-07-28
---

> TL;DR: Raw sessions are compressed into weekly digests, and only then archived. A session is never archived before a digest covers it, and archiving repoints the digest's source links so nothing is stranded.

## Why compress at all

Raw sessions accumulate faster than they become useful. A hundred sessions about one project
contain maybe six things worth remembering in six months, buried in a great deal of "ran the
tests, they passed".

Digests are where the compression happens. One digest per project per week: a summary,
decisions made, open threads, trends. The digest is what retrieval should surface a month
later; the sessions are the evidence behind it.

## Open Threads is the section that earns it

Summary and Decisions can be reconstructed from a diff. `## Open Threads` cannot — work
started and abandoned, questions raised and unanswered, branches never pushed.

That section is the one thing in a digest that a future reader genuinely cannot recover
another way, so it should not be softened. If a week's sessions carry nothing substantive,
the digest should say so plainly rather than pad.

## The archive invariant

`memory-archive.mjs` will not archive a session unless a digest lists it in `sources:`.

This invariant is the whole safety property. Archiving is compression with loss; the digest
is what makes the loss acceptable. Archiving first and digesting later means the sessions
are gone before anything captured what was in them.

`--no-require-digest` exists for manual recovery and must never be used on an unattended
run.

Because the invariant is enforced by reading `sources:` frontmatter, a wrong path there
silently strands a session forever — it can never be archived, and nothing reports it. The
digest step must write real relative paths.

## Repointing on archive

Archiving moves a note from `sessions/2026/07-14/` to `sessions/archive/2026/07-14/`. Every
digest that referenced the old path now points nowhere.

A run once stranded 92 source links this way. Links pointed at paths that no longer existed,
the digests still looked fine, and nothing surfaced the breakage until someone followed one.

Archiving now rewrites the referring digests' `sources:` entries as part of the move. The
alternative — leaving them dangling and fixing them later — means the vault is temporarily
lying, and "temporarily" in an unattended weekly loop means "until a human happens to look".

## Related

- [[brief-session-capture]] — where sessions come from
- [[brief-weekly-loop]] — the loop that runs digest and archive
- [[brief-observability]] — how a stalled digest backlog is detected
