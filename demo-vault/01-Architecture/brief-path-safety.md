---
title: Path safety — keeping requests inside the vault
tags:
  - type/brief
  - project/accretion
  - topic/security
created: 2026-06-01T09:00:00Z
last_reviewed: 2026-07-14
---

> TL;DR: Every note path from a caller is validated before it touches the filesystem. Absolute paths and traversal are rejected outright; symlinks are resolved and re-checked. The server reads and writes files on behalf of a model, so the model must not be able to name arbitrary ones.

## The threat

Tools take a `path` argument. That path may originate from a model, which may be acting on
text it retrieved, which may have come from a note somebody else wrote. Treating it as
trusted means `read_note("../../.ssh/id_rsa")` works.

This is not hypothetical prompt-injection paranoia. It is the ordinary case that a path
parameter reaches the filesystem, and the ordinary fix is to validate it.

## Three checks

`resolveSafePath()` in `src/utils/path-safety.ts`:

**Absolute paths are rejected.** Vault paths are always relative to the vault root. An
absolute path is never legitimate here, so it needs no interpretation.

**Traversal is rejected.** The path is normalised and refused if it starts with `..` or
contains a `..` segment. Normalising first matters: `a/../../b` only reveals itself as an
escape after normalisation.

**Symlinks are resolved and re-checked.** This is the one that catches people. A path can
pass both checks above and still escape, because a symlink inside the vault points outside
it. So the resolved real path is compared against the vault's real root — with both sides
resolved, since the vault root itself may be reached through a symlink.

A non-existent file is fine at this stage; create operations legitimately name files that
are not there yet. Only `ENOENT` is tolerated, and other errors propagate.

## Caching

Vault roots are `realpath`-resolved once and cached. The root does not change at runtime, and
resolving it per request adds a syscall to every single operation.

## Tilde expansion is a different problem

`expandHome()` lives in the same module but solves something else entirely: config paths from
env vars and JSON files arrive with a literal `~`, which `path.resolve` turns into a
directory named `~` in the working directory rather than the user's home.

It deliberately does not handle `~user` syntax. Resolving that needs the password database,
and treating it as the current user's home would silently point at the wrong account —
worse than failing.

Three copies of it exist: the TypeScript one here, `scripts/lib/expand-home.mjs` for the CLI
scripts (which cannot import from `dist/` before it is built), and an inline copy in
`hooks/session-journal.mjs` (deployed standalone into `~/.claude/hooks/`, where the rest of
the repo does not exist). A test asserts they agree.

## Related

- [[brief-mcp-transport]] — auth, which is the other half of the boundary
- [[brief-vault-structure]] — what a legitimate path looks like
