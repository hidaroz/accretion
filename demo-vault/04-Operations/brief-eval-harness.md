---
title: The eval harness — measuring retrieval and routing
tags:
  - type/brief
  - project/accretion
  - topic/evaluation
created: 2026-07-05T09:00:00Z
last_reviewed: 2026-08-01
---

> TL;DR: Deterministic, no LLM judge. recall@k, success@k, MRR, and routing precision over stratified cases including negatives. The negatives are the point — they price abstention, which is the property most worth protecting.

## Why it exists

Every change to retrieval or routing feels like an improvement while you are making it. The
eval is the thing that disagrees.

It is deterministic and uses no model as a judge: known-answer cases, fixed clock, same
numbers every run. An LLM-judged answer-quality tier would measure something more useful and
would also drift, cost money, and require its own validation. Retrieval and routing are
measurable exactly, so they are measured exactly first.

## Metrics

- **recall@k** — of the expected notes, how many appear in the top k
- **success@k** — did *any* expected note appear (the user-facing question)
- **MRR** — reciprocal rank of the first hit, which captures whether the right answer is at
  position one rather than position five
- **Routing precision** — of the queries that routed, how many routed correctly
- **Abstention rate** — how often routing declined
- **Negative accuracy** — how often it correctly declined on a query with no right answer

## Strata

Cases are labelled, because an aggregate hides which kind of query broke:

- `direct-name` — the note's title, near-verbatim
- `nl` — a natural-language question, the realistic case
- `terse-acronym` — a bare identifier like `RRF`, where keyword wins and semantic drowns
- `off-domain-neg` — plainly unrelated to the vault; must abstain
- `near-domain-neg` — *adjacent* to the vault's subject but genuinely uncovered; must abstain

`near-domain-neg` is the hardest and most valuable stratum. Anyone can decline to answer a
question about bicycle repair when the vault is about software. Declining to answer "how does
the vector database sharding work" when the vault is full of retrieval notes, and contains
nothing about sharding, is the actual test.

## Confidence intervals

Small case sets swing. Sixty-odd cases means one case is worth more than a percentage point,
and a two-point "improvement" is noise.

Results carry seeded bootstrap CIs, so a change that moves the headline inside the interval
can be recognised as having moved nothing. Optimising against the point estimate of a small
sample is how you fit the benchmark instead of the problem.

## The frozen clock

`SearchIndex` applies age-based recency boosts off the wall clock, so an unchanged vault
scores differently as notes age past the 7- and 30-day thresholds. The harness pins
`EVAL_EPOCH` so re-runs are identical; it is env-overridable so a fixture with different note
dates can pin its own.

## What it does not measure

Answer quality. Whether a retrieved brief actually helped. Whether a *pinned but wrong* brief
at rank one misled a caller even when recall was unchanged — that is real harm the retrieval
metrics do not see, and it is tracked separately as a known gap rather than quietly folded
into a headline number.

## Related

- [[brief-brief-routing]] — the thresholds this calibrates
- [[brief-hybrid-retrieval]] — what is being measured
- [[brief-search-index]] — why the clock must be frozen
