---
title: Session capture — the SessionEnd hook
tags:
  - type/brief
  - project/accretion
  - topic/capture
created: 2026-06-14T09:00:00Z
last_reviewed: 2026-08-01
---

> TL;DR: A global SessionEnd hook writes a note per coding session. Capture is opt-in per project — unmapped directories record nothing. Credentials are stripped before anything touches disk, blunt-instrument style.

## What it records

At the end of a Claude Code session the hook extracts, from the transcript: the topics
discussed, the files changed, and the shell commands run. It writes one markdown note to
the vault mapped to that project, then commits it.

This is genuinely broad, and the README says so out loud rather than burying it. A tool that
quietly records every shell command a developer runs is a tool that deserves to be
distrusted, however good the intent.

## Capture is opt-in

The hook is installed globally in `~/.claude/settings.json` — it has to be, or it would not
fire at all. But firing is not the same as recording.

`project-vault-map.json` maps a project directory's basename to a vault id. `_default: null`
means an unmapped project writes nothing. Setting `_default` to a vault id turns on
catch-all capture for everything, which is a legitimate choice but must be a deliberate one.

Routing fails closed. If the map is missing, unparseable, or has no entry and no default,
the hook returns without writing. The cost of a missed session is one lost note. The cost of
a wrongly-captured session is a developer's shell history in a vault they never nominated —
possibly a vault with a remote.

## Redaction

Session notes copy user messages and shell commands verbatim, and the vault auto-commits and
can be pushed. A pasted token goes to git unless something stops it first.

`redactSecrets()` runs over everything before write. It handles vendor-prefixed tokens
(`napi_`, `npg_`, `ghp_`, `sk-`, `AKIA…`), JWTs including truncated fragments, credentials
embedded in URLs, PEM private keys, and generic `FOO_SECRET=value` assignments.

It is deliberately blunt. A false positive costs one redacted word in one note; a false
negative costs a leaked credential. The trade is not symmetric, so the rules over-match.

It is also not a guarantee, and the docs say so. Treat a vault as containing whatever you
pasted into a session.

Two refinements came from watching it misbehave. The generic assignment rule originally
matched any identifier ending in "Key", which mangled `queryKey: ['orders', id]` in code
examples into nonsense. And it redacted documented placeholders like `NEON_API_KEY="your-key"`,
which are not secrets and whose redaction only made notes harder to read. Both are now
excluded by a placeholder check that runs before the generic rule.

## Resumed sessions

A resumed session ends more than once. Writing to today's date directory each time produced
up to seven byte-identical copies of a single note, which crowded genuine results out of
retrieval.

`findExistingSessionNote()` searches for the note this session already has — wherever it
lives, including under `sessions/archive/` — and updates it in place. Matching is on the
session-id suffix, with care around project prefixes: `atlas-e6e38ce4.md` and
`atlas-mobile-app-e6e38ce4.md` are different notes and must not collapse into one.

## Related

- [[brief-digests-archive]] — what happens to these notes afterwards
- [[brief-multi-vault]] — how a project resolves to a vault
- [[brief-weekly-loop]] — the curation pass that reads them
