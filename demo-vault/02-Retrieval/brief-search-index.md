---
title: Search index — keyword matching and recency
tags:
  - type/brief
  - project/accretion
  - topic/search
created: 2026-06-11T09:00:00Z
last_reviewed: 2026-07-21
---

> TL;DR: MiniSearch over title, tags, and body with field weighting and prefix matching. Recent notes get a modest boost, which is why the eval harness freezes its clock.

## Fields and weights

Title matches weigh heaviest, then tags, then body. A note titled "Brief routing" should
beat a note that says "brief routing" once in paragraph nine, and unweighted scoring gets
that backwards when the second note is longer and repeats the phrase.

Prefix matching is enabled, so "embed" finds "embedding" and "embeddings". Fuzzy matching is
deliberately conservative — aggressive edit-distance matching on a technical vocabulary
turns `gitAutoPush` and `gitAutoCommit` into the same query.

## Tag search

Tags are indexed as first-class terms, which is what makes `search_by_tag` and the routing
tag search work. The convention is hierarchical — `type/brief`, `project/accretion`,
`topic/routing` — so a prefix query like `project/` enumerates every project.

Routing's fuzzy tier searches this index scoped to briefs. That scoping is why a query can
route to a brief without that brief being the top overall search result: routing asks a
narrower question than retrieval does.

## Recency boost

Notes carry an age-based multiplier: recent notes rank slightly above equally-relevant older
ones. In a memory system this is usually right, because a note from last week about a
subject typically supersedes one from eight months ago.

It has a sharp consequence for testing. The boost is computed against the wall clock, so an
unchanged vault produces *different* rankings as notes age past the 7-day and 30-day
thresholds. A regression suite built on it would drift and then fail for no reason anyone
could reproduce.

The eval harness therefore injects a frozen clock (`EVAL_EPOCH`), so re-running the same
cases against the same vault yields identical numbers indefinitely. Production uses
`Date.now()`. Any test that indexes notes and asserts on order must pass a fixed `now`, or
it will pass today and fail in three weeks.

## Related

- [[brief-hybrid-retrieval]] — fusion with the semantic index
- [[brief-brief-routing]] — how routing uses tag-scoped search
- [[brief-eval-harness]] — the frozen clock in practice
