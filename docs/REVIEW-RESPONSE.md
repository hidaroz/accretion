# Review response — what I changed and measured

*Follow-up to your design review of the memory system. TL;DR: I took the two mandates —
narrow auto-apply, and build the measurable loop first — and shipped both. The eval already
produced an actionable finding. New questions for you at the end.*

## Your core point, adopted

> "The unsafe part isn't auto-apply itself; it's auto-apply without a measurable memory-quality loop."

I agreed, and went further than "narrow hard": I **removed unattended brief-content
auto-apply entirely**. Brief edits are semantic by nature, so confidence-gating was the
risk. The weekly autonomous run is now **propose-only** — it writes structured proposals and
stops; a human reviews and applies (`apply_brief_proposal`). `confidence` is demoted to a
triage hint, not a trigger. Deterministic housekeeping (digests, `last_reviewed` stamps,
archive, audit banners) stays automatic. Recorded as ADR-007.

## Your #1: build the eval harness before more autonomy — done

A deterministic harness (`evals/`, `scripts/memory-eval.mjs`): for a fixture of
known-answer cases it scores keyword + semantic **precision/recall@k** and **brief-routing
accuracy** against the notes a good answer should cite. No LLM in the core; pure, unit-tested
metric functions; committed scorecards as a baseline. Recorded as ADR-008.

### First baseline (work, 12 cases, k=5)

| Metric | Score |
|---|---|
| Brief routing accuracy | **100%** |
| Keyword recall@5 | 58% |
| Semantic recall@5 | **71%** |

The interesting part is the miss structure, not the headline:
- Natural-language queries (`auth-otp`, `rbac`, `cycling`, `capture`): **keyword 0% / semantic 100%** — keyword buries briefs under sessions/digests.
- A few terse briefs (`vault-structure`, `mcp-transport`, `bike-maintenance`): **keyword 100% / semantic 0%** — semantic loses them to neighbors.

**Measured conclusion: keyword and semantic are complementary; fused (hybrid) retrieval
should beat either alone — likely recall >90%.** That's now a number, not a hunch, and the
harness will tell me if a hybrid actually delivers.

## Your scaling predictions — one already bit

You flagged in-memory brute-force cosine as a future break point. It showed up immediately:
a cold semantic embed over the *full* vault (~350 notes incl. session journals) ran >15 min
single-threaded. I scoped the eval's semantic index to curated notes (briefs/digests/
knowledge) and cache vectors on disk; that's a stopgap, not a fix. Confirms your ordering.

## Deferred, deliberately (matching your guidance)

- **LLM-judge answer quality** (before/after memory) — phase 2 of the eval; deterministic
  retrieval/routing first.
- **Re-introducing a narrow, kind+invariant, eval-gated auto-apply lane** — only once the
  eval baseline justifies it. Autonomy earned back with measurement, per your line.
- **Append-only run ledger** before any multi-writer/multi-user use — not now.
- **ANN index** when curated-set cosine stops scaling.

## Where I'd value your take next

1. **Eval methodology:** is precision/recall@k against hand-labeled `expectedNotes` the right
   instrument here, or would you push for MRR / success@k / nDCG? (precision@5 is capped low
   by my 1–2-note expected sets — I'm leaning on recall@k + routing.)
2. **Hybrid retrieval:** given the complementarity, is reciprocal-rank fusion the obvious
   move, or would you rerank (cross-encoder) instead? What would you measure to call it a win?
3. **Earning auto-apply back:** if I re-introduce a narrow lane (metadata/typo + deterministic
   invariants), what eval threshold or invariant set would you require before trusting it
   unattended again?
4. **Scaling the index:** at what corpus size do you switch from in-memory cosine to ANN, and
   to what — hnswlib / sqlite-vss / lancedb — for a local-first, single-user tool?
5. **Product framing:** your "GitHub PRs for agent memory" framing stuck with me. The
   propose-only + review + diff + provenance shape now literally is that. Worth pursuing, or a
   distraction from it being a great personal tool?

Everything's committed and the system documents its own architecture/decisions in a vault it
maintains (happy to share that too). Thanks again — the review materially changed the design
for the better.

---

## Update — RRF shipped and measured (your highest-leverage next move)

Did all three: success@k + MRR added, eval expanded to **49 cases incl. 8 negatives**, and
RRF hybrid built + measured. Kept your caution in mind — the win is measured, not assumed.

**Result (work, 49 cases, k=5), stable across reruns:**

| Mode | recall@5 | success@5 | MRR |
|---|---|---|---|
| Keyword | 61.0% | 61.0% | 0.286 |
| Semantic | 74.4% | 75.6% | 0.408 |
| **Hybrid (RRF)** | **81.7%** | **82.9%** | **0.598** |

Hybrid beats both singles on recall@5 *and* MRR, routing accuracy preserved (100%), identical
across reruns → shipped as a `hybrid_search` tool. Followed your order: type-demote raw
sessions, then RRF; deferred query-expansion and cross-encoder.

**Two things the negatives + per-case view exposed (didn't have these before):**

1. **Negative-routing accuracy is only 37.5%** — 5 of 8 off-domain queries (`css→observability`,
   `pizza→observability`, `capital→analytics`, …) wrongly resolve to a brief. `get_brief`'s
   `tag_search` fallback returns *something* for almost any query. This is a real
   false-positive governance bug; next move is a relevance threshold so weak matches return
   "no brief." Your "add negative cases" call found this immediately.
2. **RRF regressed ~5 keyword-strong cases** (vault-structure, bike-maint, mcp-transport): fusion
   demoted a hit keyword had in top-5. Net win on average, but a real tradeoff — candidate
   mitigations to measure: weight keyword higher in the fusion, or cap session demotion.

So the honest scorecard: hybrid is a clear aggregate win, *and* it surfaced two concrete next
problems (routing threshold; fusion regressions) — which is the eval doing its job rather than
me declaring victory. Next: fix negative-routing, then decide whether weighted-RRF or
query-expansion closes the residual misses — measured each time.

---

## Update 2 — negative routing fixed (your #1, before RRF tuning)

Took your priority literally: fixed routing precision before touching RRF. Implemented
threshold + margin + evidence-type in a shared `routeBrief` (one source of truth for
`get_brief`, `get_context`, and the eval): `direct_map` and exact-title route freely; the
fuzzy `tag_search` fallback must clear a score floor AND beat #2 by a ratio, else it
**abstains**. `get_brief` now returns "no confident brief — related notes (verify)" instead
of a wrong brief.

Calibrated by sweep (not learned from 8 negatives), on 66 stratified cases:

| Routing metric | Before | After (floor 8, ratio 1.3) |
|---|---|---|
| Negative-routing accuracy | 37.5% | **92.3%** |
| Routing precision (of routed) | — | **98.1%** |
| Positive routing recall | 100% | **100%** (untouched) |
| Abstention rate | 0% | 18.2% |

The sweep showed positive recall stays 100% across every threshold — the gate only ever
touches the fuzzy fallback, never confident routes. Per-stratum: off-domain negatives abstain
100%, near-domain 80% (1 residual: "support phone number" still fuzzy-matches the Observability brief
— a near-domain edge to chip at). Hybrid retrieval held at recall@5 82.1%, **95% CI
[71.7%, 91.5%]** — deliberately reporting the CI because, as you said, 53 positives swing.

Did the rest of your eval guidance too: added success@k + MRR, **strata** tags, **seeded
bootstrap CIs**, and a two-tier eval (fast curated / `--faithful` all-notes). Still deferred,
in your order: RRF weighting + exact-match pinning (now next, since routing is fixed),
full-100 cases, cross-encoder.

Open question for you: the residual near-domain false positive (support-phone → Observability). Worth
adding an absolute-floor bump or a st​opword/!brief-term guard, or is 92% neg-accuracy a fine
place to stop and move to RRF tuning?
