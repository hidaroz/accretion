---
title: Onboarding — bootstrap, setup-vault, doctor
tags:
  - type/brief
  - project/accretion
  - topic/onboarding
created: 2026-06-30T09:00:00Z
last_reviewed: 2026-08-01
---

> TL;DR: `bootstrap` wires the machine, `setup-vault` wires a project, `doctor` says whether it worked. All three are idempotent and back up anything they overwrite.

## Three scopes

**`bootstrap.mjs` — per machine, once.** Verifies Node, installs and builds, copies the
capture hook into `~/.claude/hooks/`, installs the `/memory-weekly` command into
`~/.claude/commands/`, merges the SessionEnd hook into `~/.claude/settings.json`, and
optionally installs a launchd agent to auto-start the server.

**`setup-vault.mjs` — per project.** Creates the skeleton, seeds `brief-map.json`,
`.gitignore` and a Home MOC, registers the vault, routes project slugs to it, optionally
git-inits and generates a launchd plist for the weekly run.

**`doctor.mjs` — read-only, any time.** Checks Node version, that `dist/` is built, that the
registry is valid, that each vault path exists, that the hook and command are installed, that
the server responds, and that the weekly loop is actually alive.

## Idempotence means never destroying

Both installers write into `~/.claude`, which is not namespaced to this project. A user may
have their own `session-journal.mjs` there.

So: anything overwritten is backed up first with a timestamped `.bak-` suffix, and only when
the content actually differs. `settings.json` is merged rather than replaced, and the merge
is a pure function with unit tests, because silently corrupting a user's global Claude Code
config is not a recoverable error for them.

`setup-vault --git` refuses to commit in a pre-existing repo with uncommitted changes.
`--path` can legitimately point at a repo that already exists, and `add -A && commit` there
would sweep unrelated in-flight work into a commit message about initialising a memory vault.

## Doctor's design rule

A check that is always red is a check nobody reads.

So the severity depends on state, not just presence. A vault that has never been curated
gets a **warning** — it simply has not been set up. A vault that *has* been curated and then
stopped has **regressed**, and that is a failure worth shouting about.

The same rule applies to the `/memory-weekly` command: missing is only a failure if something
is actually scheduled to call it. On a fresh install nothing is, and failing there would make
the documented final verification step red for every new user.

This principle was learned the hard way — the check for that command was unconditionally
fatal for a long time, which meant the documented happy path ended in a red failure for
everyone who followed it.

## Verifying a genuine first run

Testing onboarding against your own machine proves nothing; it is already configured. Use a
throwaway `$HOME`:

```bash
FAKE=$(mktemp -d)
HOME=$FAKE CLAUDE_HOME=$FAKE/.claude node scripts/bootstrap.mjs --skip-install
HOME=$FAKE CLAUDE_HOME=$FAKE/.claude node scripts/doctor.mjs   # must exit 0
```

## Related

- [[brief-observability]] — what doctor checks in depth
- [[brief-multi-vault]] — the files setup-vault writes
- [[brief-mcp-transport]] — starting the server
