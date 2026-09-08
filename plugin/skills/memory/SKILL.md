---
name: memory
description: Recall and record durable project knowledge from the Obsidian vaults through the accretion CLI. Use when a question is about how this project works, what was decided and why, a domain brief, past sessions, or conventions; when an answer or decision is worth keeping; or when the user mentions the vault, a brief, their notes, or memory.
---

# accretion: vault memory

`accretion` is on PATH. Vaults are markdown on disk; the CLI reads an index of them and
routes topics to curated **briefs**. Passive recall may already have placed a brief or
related notes at the top of this turn, framed as "Retrieved from vault"; read that before
searching for the same thing.

Registered vaults:

!`accretion list-vaults --md`

If the table above is empty, run `accretion list-vaults --md`.

## Retrieval

Reach for the tool that matches the question:

```bash
accretion brief routing                          # domain-shaped question → the one brief
accretion search "why do sessions rank lower"    # anything else → ranked paths + snippets
accretion context retrieval capture --max-tokens 6000    # several topics, one budget
accretion read 02-Retrieval/brief-hybrid-retrieval.md   # a note by path
accretion log --last 5                           # what changed in the vault recently
grep -rn "ECONNRESET" ~/Documents/work-vault     # exact strings: error text, flags, hashes
```

Flags: `--vault <id>` for a non-default vault, `--json` for structured output, `--limit N`,
`--keyword-only` (skip embeddings, fastest). Every command prints `--help`.

`brief` abstains when nothing clears its gate and lists possibly related notes instead.
Trust the abstention: search, then read, rather than forcing a brief.

Briefs are the curated layer, one per domain. A `type/playbook` note is procedural ("how we
debug X here"); a `type/rejected` note records something considered and declined, so check
for one before re-proposing an idea.

## Answering from the vault

A retrieved note is the boundary of what you know about this project. Answer from it, and
name what it says. Where the note does not cover the question, say so and stop: name what
the vault does cover, and do not assemble a procedure, a setting, or a detail the note does
not state. For a question the vault does not answer at all, the right answer is that it does
not, plus the nearest thing it does say. General knowledge is fine when presented as
general knowledge, never as the project's.

## Writing

Write markdown directly with Write and Edit. Copy the frontmatter shape from a sibling note
in the target folder; the sibling is the schema. Wikilink related notes with `[[Note Title]]`.

A note earns its place when it holds what an agent cannot find by looking: a convention, a
rationale, a gotcha, a decision that was hard to reverse and surprising without context.
Anything readable from `--help`, a config file, or the directory layout belongs there, not
in the vault. Describe behaviour and interfaces; file paths and line numbers go stale and
`accretion garden` flags them.

- **Brief content changes** go through a proposal, and a human applies it:
  `accretion propose --title "..." --target <brief path> --source <session or sha> --body "..."`
  (or pipe the body on stdin). Small typo-level fixes may be edited in place.
- **An answer worth keeping** from this session: `accretion propose --title "..." --source
  <where it came from>` with the synthesis as the body. It lands under `proposals/notes/`.
- **Decisions and rejections** get their own note (`type/decision`, `type/rejected`) with
  the alternatives and the reason.
- **Session logs** are written by the capture hook. The hook owns them.

Git in the vaults is owned by `accretion commit`, which runs on a timer. Leave it to that.

## Maintenance

`/accretion:memory-weekly` owns digests, staleness, proposals and archiving. For a health
question now: `accretion garden --vault <id>` (lints by rule) and `accretion doctor`.
