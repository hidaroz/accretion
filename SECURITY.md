# Security

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/hidaroz/accretion/security/advisories/new).
Please don't open a public issue for anything exploitable.

Expect an acknowledgement within a week. This is a personal project, not a funded
one — there's no bounty, and no guaranteed patch window.

## What this software does to your machine

Worth knowing before you run it, because some of it is broader than a "read my notes"
tool implies:

**The capture hook is global.** `bootstrap.mjs` writes a `SessionEnd` hook into
`~/.claude/settings.json`. It then fires in **every project you open**, not just ones you
registered. What it records, for projects you have mapped: session topics, changed file
paths, and executed shell commands — written to a vault and `git commit`ed.

Capture is opt-in per project. `_default: null` in `project-vault-map.json` means unmapped
projects are skipped entirely. Setting `_default` to a vault id turns on catch-all capture;
do that deliberately.

**Session content is redacted, imperfectly.** `redactSecrets()` in
`hooks/session-journal.mjs` strips credential shapes (vendor tokens, JWTs, URL-embedded
passwords, `FOO_SECRET=` assignments) before anything is written. It is deliberately blunt
and it is not a guarantee. Treat a vault as containing whatever you pasted into a session.

**`gitAutoPush` defaults to false.** If you enable it, session notes are pushed to a remote
automatically. Point that at a private repo.

**The weekly loop is an unattended agent with write access.** `bin/memory-weekly-run.sh`
spawns a headless Claude with `Read`/`Write`/`Edit` and `Bash(node:*)`/`Bash(git:*)`. Note
that `Bash(node:*)` permits `node -e '…'`, which is effectively arbitrary code execution;
the loop is bounded by its instructions, not by that allowlist. It runs **dry-run by
default** for this reason — `--apply` opts into mutation, commits, and pushes.

**The server binds localhost by default.** `HOST=127.0.0.1`. Every `/mcp` request requires
a `Bearer` token. If you set `HOST=0.0.0.0` to expose it (Docker, a LAN), you are
responsible for what sits in front of it — and note that CORS is currently unrestricted
(tracked as a known issue), so a web page can attempt cross-origin requests to it.

## Known gaps

Tracked in the issue tracker rather than hidden here: unrestricted CORS on the HTTP
server, and the breadth of the weekly loop's `Bash` allowlist.
