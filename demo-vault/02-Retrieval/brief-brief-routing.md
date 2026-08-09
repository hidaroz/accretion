---
title: Brief routing — confidence gates and abstention
tags:
  - type/brief
  - project/accretion
  - topic/routing
created: 2026-06-05T09:00:00Z
last_reviewed: 2026-07-28
---

> TL;DR: Routing picks the one canonical brief for a query, or picks nothing. Exact evidence routes freely; fuzzy matches must clear a score floor, beat the runner-up by a margin, and carry a token tying them to that specific brief. Abstention is a correct answer.

## The asymmetry that drives the design

A retrieval miss and a routing error cost different amounts.

If retrieval misses a note, the caller sees four other results and can tell something is
absent. The failure is visible and recoverable.

If routing returns the *wrong* brief, the caller gets a confident, well-formatted, canonical
document about the wrong subject, pinned to the top of their context. They have no signal
that anything went wrong — the output looks exactly like a correct answer. They then reason
from it.

So routing is tuned for precision, not recall, and "no brief" is a first-class result. A
system that abstains on a third of queries and is never wrong is more useful than one that
always answers and is wrong one time in twelve.

## Three routes, in order

**1. Direct map.** `.mcp/brief-map.json` maps keywords to brief paths. A hit here is
explicit human intent — someone wrote down that this word means this brief — so it routes
with no threshold at all.

**2. Exact title.** The query exactly matches a brief's title. Also unambiguous evidence,
also no threshold.

**3. Fuzzy tag search.** Everything else. This is where wrong answers come from, so it must
clear three independent gates:

- **Floor** — the top hit's score must exceed `DEFAULT_FLOOR`. Filters out queries where
  nothing matched well and the top result is just the least-bad noise.
- **Margin** — the top hit must beat the second by `DEFAULT_MARGIN_RATIO`. If two briefs
  score similarly the query is ambiguous, and picking the marginal winner is a coin flip
  dressed up as an answer.
- **Domain trigger** — the query must contain a token tied to *that* brief: one of its
  brief-map keywords, a word from its title, or a slug token.

## The domain trigger does the real work

Floor and margin are necessary but not sufficient. Both are satisfiable by a query that is
simply *closest* to some brief while being about nothing in the vault at all.

The concrete failure: "what's the support phone number" has no answer in the vault. Keyword
scores are all low, but one brief edges out the others on incidental token overlap, clears
a low floor, and beats a very weak second place by a wide ratio. Both numeric gates pass.
The system confidently returns a brief about something else entirely.

The trigger closes this. Routing requires positive evidence that the query is *about* the
brief it is routing to, not merely nearer to it than to anything else. Intent over
proximity.

Note that the stopword list used for tokenising the trigger is for tokenising only. It
drops "how", "what", "the" so they cannot serve as evidence. It is not a domain blocklist —
intent is established by what the query *does* contain, never by what it doesn't.

## Why the floor stays low

It would be easy to crank `DEFAULT_FLOOR` until nothing wrong ever routes. That also kills
every legitimate fuzzy route, and the system stops answering paraphrased questions at all —
which is most real questions.

The trigger is the precision instrument. The floor is a coarse noise filter. Raising the
floor to do the trigger's job trades away recall for precision the trigger already provides
more cheaply.

## Calibration is per-vault

`DEFAULT_FLOOR = 4` and `DEFAULT_MARGIN_RATIO = 1.3` are calibrated against this vault.
MiniSearch scores are relative to corpus size and term distribution, so a substantially
different vault may need its own values. `memory-eval.mjs --sweep-routing` prints
precision, recall, abstention and negative accuracy across a grid; pick a conservative
high-precision point.

Do not tune these to make a scorecard look better. The negative strata exist to keep the
cost of over-tuning visible.

## Related

- [[brief-hybrid-retrieval]] — how a routed brief gets pinned into results
- [[brief-eval-harness]] — the strata that measure abstention
- [[brief-vault-structure]] — where brief-map.json lives
