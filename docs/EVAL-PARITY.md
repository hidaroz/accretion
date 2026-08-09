# Eval parity and the deterministic clock

Two ways this eval harness was measuring something other than what the product does, and
what it cost to find out. Both are the kind of bug that makes a system look *better* than it
is, which is the kind least likely to be investigated.

Context for the narrative these came out of: [`REVIEW-RESPONSE.md`](REVIEW-RESPONSE.md) §7.

---

## Bug 1: the harness was doing work the product doesn't

Each eval case carries a hand-written `topic` keyword alongside its `query` — a clean token
like `"routing"` or `"digests"`.

- **Live `hybrid_search`** pins the brief routed from the raw **query**
  (`src/tools/hybrid-search.ts` → `routeBrief(ctx.briefMap, ctx.searchIndex, query)`).
- **The eval** pinned the brief routed from `c.topic || c.query`.

`rrf()`'s `pins` argument forces the pinned brief to rank 1. So the harness was handing the
routing layer a clean keyword no real caller supplies, then crediting the resulting rank-1
hit to retrieval quality.

The headline was therefore an **upper bound the product could not reach**, and there was no
way to tell how much of it was assistance until the two paths were separated.

### The fix: three modes, reported separately

| Mode | What it pins | Status |
|---|---|---|
| `hybrid_raw` | nothing | pure retrieval |
| `hybrid_query_pin` | brief routed from the raw **query** | **matches the live tool — headline** |
| `hybrid_topic_pin` | brief routed from the clean **topic** | diagnostic only |

`topic_pin` is not deleted, because it is faithful to `get_brief` — which really does take an
explicit topic argument. It is simply not the headline, and the **parity delta**
(`topic_pin − query_pin`) is printed on every scorecard and labelled as harness assistance
rather than product behaviour.

## Bug 2: the scorecard drifted on the wall clock

`SearchIndex.search` applies age-based recency boosts computed from `Date.now()`. An
unchanged vault therefore scores differently as notes age past the 7- and 30-day thresholds.

A regression harness built on that cannot support period-over-period comparison: a number
that moved might mean a code change regressed, or might mean a week went by.

**Fix:** an injectable clock — `new SearchIndex({ now })` — defaulting to `Date.now`, so
production is unchanged. The eval pins `EVAL_EPOCH` and stamps it into every artifact.
It is env-overridable so a fixture with different note dates can pin its own.

Any test that indexes notes and asserts on ordering must pass a fixed `now`, or it will pass
today and fail in three weeks for no reason anyone can reproduce.

---

## Not every wrong route is harm

The first attempt at counting routing mistakes lumped them together as "pin false
positives", which overstated the damage. A wrong route only matters if it changes what the
caller sees.

They are now reported as a strict subset chain:

```
wrong route  ⊇  applied pin  ⊇  pin-induced retrieval regression
                                   ├─ severe: expected note dropped out of top-k
                                   └─ mild:   demoted from rank 1, still in top-k
```

- **Wrong route** — routing returned a brief that isn't the expected one.
- **Applied pin** — that brief was *also* retrieved, so `rrf()` actually pinned it. `rrf()`
  ignores pins for unretrieved notes, so a wrong route is often inert.
- **Regression** — the applied pin displaced an expected note *relative to raw RRF*.

The umbrella is deliberately named **"pin-induced retrieval regression (vs raw RRF)"** and
not "harm". It measures regression against raw RRF, which is not the same as all possible
user harm: a wrong pin sitting at rank 1 can mislead whatever reads the context first, even
when recall@k is completely unchanged. That gap is tracked as a known unmeasured risk rather
than quietly absorbed into a number that looks fine.

## `--no-semantic` suppression is a choice, not a limitation

In `--no-semantic` mode the applied-pin and regression tiers print "suppressed in
no-semantic" rather than a value.

The earlier label said "requires semantic", which was wrong: applied pins *can* arise from
keyword-only candidates. Suppressing them is a deliberate decision to avoid publishing a
tier computed over a different candidate pool than the one the headline describes. Labelling
a choice as a limitation hides that someone made a decision.

## Reproducing

```bash
node scripts/memory-eval.mjs --vault demo                 # curated (semantic on)
node scripts/memory-eval.mjs --vault demo --no-semantic   # keyword + routing only
```

Result files are mode-stamped, so the two runs no longer clobber each other, and each embeds
its `EVAL_EPOCH`.
