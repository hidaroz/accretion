---
title: Embedding index — local inference, no network at query time
tags:
  - type/brief
  - project/accretion
  - topic/embeddings
created: 2026-06-09T09:00:00Z
last_reviewed: 2026-07-21
---

> TL;DR: `all-MiniLM-L6-v2` runs locally through transformers.js. Weights download once and cache; nothing leaves the machine when you search. Only curated notes are embedded, which keeps the index build in minutes rather than hours.

## Local, deliberately

The whole premise of this system is that your notes are yours. Shipping every query and
every note to a hosted embedding API would contradict that, and would make the tool unusable
in exactly the environments that most need a private memory — client work under NDA,
regulated industries, anywhere the notes are the sensitive thing.

`@xenova/transformers` runs the model in-process. Model weights are fetched from the
HuggingFace hub on first use and cached on disk. After that the machine can be offline.

`EMBEDDING_MODEL` overrides the model; `TRANSFORMERS_CACHE` overrides where weights land.
For locked-down environments, pre-seed the cache and set `TRANSFORMERS_OFFLINE`, or point
`EMBEDDING_MODEL` at a vendored directory.

`DISABLE_EMBEDDINGS=1` turns the whole tier off. The server then runs keyword plus routing
only, which is a legitimate configuration — it loses roughly the paraphrase-handling third
of retrieval and gains a fast cold start.

## Lazy loading

The model loads on first use, not at startup. Server boot and the entire test suite never
pay for it unless something actually embeds. This matters more than it sounds: the model is
~90MB and takes seconds to initialise, and most test runs touch no embeddings at all.

## Curated notes only

The index covers briefs, digests, and knowledge notes. It excludes raw session notes.

This is a cost decision with a quality side effect. Embedding a full vault including every
raw session took over fifteen minutes on first build; curated-only takes a few minutes and
then caches to `.mcp/embeddings.json`.

The side effect is beneficial: raw sessions are verbose and repetitive, and embedding them
would flood the semantic neighbourhood of every query with near-duplicate chunks of
transcript. Excluding them is the same instinct as demoting them in fusion, applied earlier.

## Vectors are L2-normalised

Returned vectors are unit length, so cosine similarity is a plain dot product. Given a
curated corpus in the low thousands of chunks, an exhaustive scan is effectively instant and
an approximate-nearest-neighbour index would be premature. Somewhere around 50k chunks that
stops being true and ANN becomes worth the dependency.

## Cache invalidation

The cache keys on note path and content hash. Editing a note re-embeds that note only.
Deleting the cache forces a full rebuild, which is the usual fix when results look stale
after a bulk edit.

## Related

- [[brief-hybrid-retrieval]] — how these results fuse with keyword search
- [[brief-search-index]] — the keyword half
- [[brief-vault-structure]] — what `.mcp/` holds
