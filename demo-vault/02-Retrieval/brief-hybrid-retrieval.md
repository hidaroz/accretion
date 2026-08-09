---
title: Hybrid retrieval — keyword and semantic, fused
tags:
  - type/brief
  - project/accretion
  - topic/retrieval
created: 2026-06-02T09:00:00Z
last_reviewed: 2026-07-28
---

> TL;DR: Keyword search and local embeddings each miss a different third of the corpus. Reciprocal-rank fusion combines their rankings without needing their scores to be comparable, and the routed brief is pinned into the result set so the canonical answer cannot be crowded out.

## Why two indexes

Keyword search (MiniSearch) and vector search fail in opposite directions, and the failures
are not correlated.

Keyword search nails exact vocabulary. Ask it for "RRF" or "gitAutoPush" and it returns the
right note at rank one. Ask it "how do I stop it recording everything" and it returns
nothing useful, because the note says "capture is opt-in per project" and shares not one
content word with the question.

Semantic search handles the paraphrase and fails on the identifier. Embeddings put "stop
recording everything" next to "capture is opt-in" without difficulty. But a short brief
whose distinguishing feature is a rare token gets averaged into mush — the vector for a
note about `gitAutoPush` sits near every other note about git, because 300 words of
surrounding prose dominate one token.

Running only one of them means accepting whichever failure mode you picked. Running both
and fusing them means a note needs to be missed by *both* strategies to be lost.

## Reciprocal-rank fusion

The scores are not comparable. MiniSearch returns a BM25-ish relevance number scaled to the
corpus; cosine similarity returns a bounded number with a completely different
distribution. Normalising them against each other requires a calibration that would need
redoing for every vault.

RRF sidesteps this by discarding the scores and using only the ranks:

```
score(doc) = Σ  1 / (k + rank_i(doc))
```

over each ranking `i` the document appears in, with `k = 60` damping the top-heaviness. A
document at rank 1 in one index and absent from the other scores below a document at rank 3
in both — which is the behaviour worth wanting, because agreement between two independent
methods is stronger evidence than confidence from one.

The implementation lives in `src/vault/hybrid.ts`.

## Raw sessions are demoted

Session notes vastly outnumber briefs and are far more verbose. Left alone they dominate
retrieval — a query about scheduling returns nine session notes that mention scheduling in
passing and buries the brief that actually explains it.

`isRawSession()` identifies them by path, and fusion demotes them. They stay retrievable,
because sometimes the raw session *is* the answer, but they no longer outrank the curated
note written specifically to answer that question. Digests are not demoted: a digest is
curated output, not raw capture.

## Exact-match pinning

When routing identifies a canonical brief for a query with confidence, that brief is pinned
into the result set rather than left to compete on rank.

This was added after observing a specific failure: the router would correctly identify the
right brief while fusion simultaneously ranked it sixth, below several sessions that merely
mentioned the topic. The system knew the answer and then declined to show it.

Pinning only applies when the pinned note was actually retrieved by at least one index.
Pinning an unretrieved note would be asserting relevance no index found any evidence for,
which is the failure mode routing abstention exists to prevent.

## Related

- [[brief-brief-routing]] — how the canonical brief is chosen, and when it abstains
- [[brief-embedding-index]] — the local model and its caching
- [[brief-search-index]] — keyword indexing and recency boosts
- [[brief-eval-harness]] — how these numbers are measured
