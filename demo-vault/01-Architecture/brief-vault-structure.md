---
title: Vault structure — folders, frontmatter, and the brief map
tags:
  - type/brief
  - project/accretion
  - topic/structure
created: 2026-05-30T09:00:00Z
last_reviewed: 2026-07-21
---

> TL;DR: Plain markdown in a git repo, readable in Obsidian with the server switched off. A fixed skeleton the lifecycle tools rely on, hierarchical tags, and `.mcp/brief-map.json` mapping keywords to canonical briefs.

## Markdown, in git, on purpose

The core bet: memory should stay legible. Not embeddings in a database you can only query
through the tool that wrote them — files you can open, read, edit in any editor, diff, and
grep.

The costs are real. There is no native vector store, so semantic search is bolted on. There
is no query language beyond what gets built. Scale is bounded by what fits comfortably in a
git repo.

What it buys: the memory outlives the tool. If this project is abandoned tomorrow, the vault
is still a folder of notes that makes sense. Every migration is a text transformation. Every
"why did it decide that" question is answerable by reading a file. And git provides history,
sync, and encryption-at-rest (via git-crypt) without any of it being implemented here.

## Skeleton

`SKELETON_DIRS` in `vault-onboarding.ts` defines what `setup-vault` creates:

```
sessions/digests/_runs     run reports from the weekly loop
sessions/archive           digest-covered sessions, post-archive
proposals/brief-updates    pending human review
MOCs                       maps of content
Knowledge                  durable notes that aren't briefs
00-Index                   entry points
.mcp                       machine state: brief-map.json, embeddings.json
```

Numbered topic folders (`01-Architecture`, `02-Retrieval`, …) are convention, not
requirement — retrieval works on tags and content, not paths. Only the folders above are
structural, because tools address them directly.

## Frontmatter

```yaml
title: Human-readable title
tags: [type/brief, project/accretion, topic/routing]
created: 2026-05-30T09:00:00Z
last_reviewed: 2026-07-21
```

`title` drives exact-title routing and is weighted heaviest in search. `tags` are
hierarchical, which makes prefix queries useful. `last_reviewed` drives staleness detection.

Digests additionally carry `period`, `session_count`, and `sources` — and `sources` must
hold real relative paths, because archiving reads it to decide what is safe to remove.

## The brief map

`.mcp/brief-map.json` is a flat keyword → path object:

```json
{ "routing": "02-Retrieval/brief-brief-routing.md" }
```

An entry is a human asserting that this word means this brief. Routing treats it as the
strongest evidence available and applies no threshold to it.

It is watched, so edits take effect without a restart — unlike code changes.

Keep it small. Every entry is a promise, and a stale entry pointing at a moved note is worse
than no entry: routing follows it with full confidence into a note that no longer exists.

## Related

- [[brief-brief-routing]] — how the map is consumed
- [[brief-digests-archive]] — the `sources` contract
- [[brief-onboarding]] — what creates all this
