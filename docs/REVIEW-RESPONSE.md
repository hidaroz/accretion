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

---

## Update 3 — domain-trigger guard (not a floor bump) + exact-match pinning

Took both calls exactly as you framed them.

**Routing — positive-evidence guard, no global floor bump.** A fuzzy `tag_search` now routes
only if the query carries a *domain trigger* tied to that brief (a brief-map keyword / title /
slug token); else it abstains. No blocklist — it's positive evidence, and tokenization
stopwords aren't a domain ban-list. Reverted the floor back to 4 (the guard does the work, so
legit fuzzy routes aren't quietly starved). Result on 66 stratified cases:

| Routing | before | after |
|---|---|---|
| Negative-routing accuracy | 37.5% | **100%** |
| Routing precision (of routed) | 98% | **100%** |
| Positive routing recall | 100% | **100%** |

`support phone number` now abstains (no Observability term); `weekly loop dry run` / `sourdough hydration`
still route. The sweep showed the guard makes routing precision/neg-accuracy 100% at *every*
floor/margin — i.e. it's the conceptual fix, not threshold fiddling, as you said.

**RRF — exact-match pinning before weighted RRF.** If the query has a canonical route
(brief-map / exact title / alias) and that brief was retrieved, it's pinned into the fused
top-k so fusion can't demote it. Did **not** do global keyword weighting. Retrieval:

| Mode | recall@5 | MRR |
|---|---|---|
| Keyword | 66% | 0.33 |
| Semantic | 78% | 0.42 |
| **Hybrid (pinned RRF)** | **98.1%** | **0.98** |

Hybrid recall@5 95% CI **[94.3%, 100%]**. The vault-structure / mcp-transport / bike-maintenance class is
fixed by pinning rather than weighting, as you predicted.

**Two honest caveats (not declaring victory):**
1. **1 residual miss — `mcp-transport`:** neither keyword nor semantic surfaces the transport brief for
   "how are the transport layers organized," so pinning (which requires the brief to be *retrieved*,
   per your "keyword finds it") can't rescue it. A genuine retrieval gap → candidate for your
   step-3 (title/frontmatter-enriched embeddings) or enriching the brief. Not papering over it.
2. **The 98% leans on strong routing on this case set** — most positives have a clean
   brief-map route, so pinning shines. On queries where routing abstains, hybrid falls back to
   raw fusion (~80s). So this is 98% *on this distribution*, with a still-modest 53-positive
   sample (hence the CI). Real next step is your call: **push the negative+positive set toward
   100 stratified before trusting these as stable**, and only then consider weighted RRF (which
   pinning may have made unnecessary).

---

## Update 4 — the 98% was an upper bound, not product behavior (you were right to distrust it)

You caught the thing Update 3 was quietly leaning on: **the eval pinned the brief routed from
`c.topic || c.query` — a clean keyword — while live `hybrid_search` only ever sees the raw
`query`.** So the 98.1% was crediting retrieval for a routing assist real callers never get. I
made the eval measure all three modes side by side and froze the clock so the numbers stop
drifting. Full write-up: `docs/2026-06-28-eval-parity-split.md`.

**Retrieval (work, 66 cases, k=5, frozen clock) — `evals/results/2026-06-28-curated.md`:**

| Mode | recall@5 | success@5 | MRR |
|---|---|---|---|
| Keyword | 62.3% | 62.3% | 0.317 |
| Semantic | 78.3% | 79.2% | 0.424 |
| Hybrid raw (no pin) | 80.2% | 81.1% | 0.582 |
| **Hybrid query-pin (live)** | **85.8%** | **86.8%** | **0.759** |
| Hybrid topic-pin (diagnostic) | 98.1% | 98.1% | 0.981 |

So **topic-pin was an upper bound; the honest live number is 85.8%** (CI [76.4%, 94.3%] — still a
53-positive sample). The 12.3-pt gap is harness assistance. Query-pin is now the headline; topic-pin
stays as a diagnostic. The frozen `EVAL_EPOCH` (embedded in every scorecard) makes reruns
byte-identical — `SearchIndex`'s recency boost was running off `Date.now()`, so the regression
harness was drifting as notes aged past the 7/30-day thresholds.

**Then I fixed the four artifact/measurement issues you flagged on that round:**

1. **Result files clobbered each other** (my own `--no-semantic` verification run had overwritten
   the semantic-on scorecard — the 85.8% only existed in the doc). Files are now mode-stamped:
   `2026-06-28-curated.{md,json}` / `…-no-semantic.{md,json}`.
2. **Live query-route false positives were unmeasured** — routing precision was still topic-based,
   so a bad raw-query route could pin a wrong brief in production while the scorecard showed 100%.
   There's now a separate **query-path routing table** with a **pin false-positive** count.
3. **`--no-semantic` output was inconsistent** (blanked hybrid rows but still printed a query-pin
   CI/misses). Now it cleanly suppresses everything semantic-dependent and stays a keyword+routing
   diagnostic.
4. **`EVAL_EPOCH` wasn't in the artifact** — now in the header and JSON.

**The query-path table immediately earned its keep — it found the live wrong-pin you predicted:**

| Routing metric | Topic path (`get_brief`) | Query path (live `hybrid_search`) |
|---|---|---|
| Precision (of routed) | 100% | 95.8% |
| Recall (positives routed) | 100% | **43.4%** |
| Abstention | 19.7% | **63.6%** |
| Negative accuracy | 100% | 100% |
| Pin false-positives | — | **1** (`observability-migration`) *— refined into 3 tiers in Update 5* |

On raw NL queries the router **abstains 63.6%** of the time (no pin → that's why query-pin recall
sits at 85.8% vs topic-pin's 98.1%), and one wrong route (`observability-migration`) got pinned. *(You
correctly flagged that "pin false-positive" overstates it — see Update 5 for the route/applied/
harmful split; it turns out applied + harmful, but mildly.)* The topic-path 100% was hiding both.
**NL-query routing — not fusion — is the real gap**, which also retires the weighted-RRF question:
fusion isn't the bottleneck.

**Honest status:** parity split + clock + the four fixes are done, 392 tests green, reruns
reproducible, not yet committed. The `mcp-transport` miss from Update 3 still stands (pure retrieval
failure, pin-independent — your step-3).

**Where I'd value your take next:**
1. **NL routing** is the headline gap. Lower the confidence floor for the query path, add a
   measured "route-injected hybrid" 4th mode (routed brief as a tiny third RRF source when
   high-confidence — more blast radius from routing mistakes), or leave routing strict? I'd want
   the ~100-case set in place before tuning.
2. **Telemetry before more cases?** `hybrid_search` logs nothing today. Logging real queries
   (top paths, route method, pin path, whether the pin was retrieved) would seed the next 100
   cases from actual usage instead of hand-invented ones — arguably higher-leverage than authoring
   cases now.
3. **`EVAL_EPOCH`** is pinned to 2026-06-28. Re-pin on each scorecard refresh (tracks the live
   vault) or leave fixed (comparable over time)? Currently fixed.

---

## Update 5 — "pin false-positive" split into route / applied / harmful (you were right)

You caught that my Update-4 metric conflated three things: it counted any wrong raw-query *route*,
but `rrf()` only applies pins that were already retrieved (`src/vault/hybrid.ts:39` —
`pins.filter((p) => score.has(p))`), and even an applied pin only matters if it displaces an
expected note. Split into the three tiers you named (each a strict subset of the one above):

| Tier | Count | Cases |
|---|---|---|
| Wrong query routes (route ≠ expected brief) | 1 | `observability-migration` |
| ↳ Applied wrong pins (route was retrieved → pinned by RRF) | 1 | `observability-migration` |
| ↳ Harmful wrong pins (displaced an expected note) *— renamed "pin-induced retrieval regression (vs raw RRF)" in Update 6* | 1 | `observability-migration` |
| &nbsp;&nbsp;• severe (expected note dropped from top-5) | **0** | — |
| &nbsp;&nbsp;• mild (demoted from rank 1, still in top-5) | **1** | `observability-migration` |

So `observability-migration` *is* applied and *is* harmful — but **mildly**: `"what is the Observability migration
roadmap"` routes to the Observability *observability* brief, which gets pinned to rank 1, demoting the actual
roadmap note from rank 1 → rank 2. recall@5 preserved (still in top-5), MRR 1.0 → 0.5, **zero
expected notes dropped from top-k.** Less alarming than Update 4's "reaches production," more
precise. (I added the severe/mild breakdown beyond your three tiers because the blast radius
genuinely differs — a top-k drop loses the answer; a rank-1 demotion just buries it one slot.)
`harmful ≤ applied ≤ wrongRoutes` is asserted in the scorecard; metrics live in
`evals/results/2026-06-28-curated.json` under `pinAnalysis`. The query path needs the retrieval
candidate set, so applied/harmful read `—` in `--no-semantic` mode.

**Your guidance on the open questions — recorded as decisions, thank you:**
- **NL routing:** not lowering the floor yet. Expanding to ~100 cases and classifying misses
  ("should route from NL" vs "retrieval should handle it") first.
- **Route-injected mode:** experiment-only, not shipping — it bypasses the `rrf()` unretrieved-pin
  safeguard, so it makes wrong routes more dangerous.
- **Telemetry:** doing this next, before authoring more cases (route method/path, pin-applied?,
  top paths, semantic availability) — agreed it gives better strata than invented queries.
- **`EVAL_EPOCH`:** staying fixed for the regression baseline; live-clock only as an exploratory
  report.

Net, per your framing: the harness now distinguishes wrong routes from applied/harmful pins, and
**telemetry is the agreed next highest-leverage step**.

---

## For your review (Updates 4–5)

All three rounds are in the working tree, **not yet committed** — review before I commit. 392
tests green, `npm run build` clean, scorecards reproducible across reruns.

**Diff surface (what to read):**

| File | What changed | Worth scrutinizing |
|---|---|---|
| `src/vault/search-index.ts` | Injectable clock (`now`), defaults to `Date.now` | Is constructor injection the right seam, or would you pass the clock into `search()`? |
| `src/eval/metrics.ts` | `hybrid` → `hybridRaw` / `hybridQueryPin` / `hybridTopicPin` | Naming + whether `hybridQueryPin` is the right headline |
| `scripts/memory-eval.mjs` | parity split, frozen `EVAL_EPOCH`, dual routing tables, **pin route/applied/harmful tiers**, mode-stamped artifacts | **The harmful-pin classification** (`droppedTopK` / `lostRank1`, lines ~170–185) — does my definition of "harmful" match what you meant? |
| `src/__tests__/{search-index,eval-metrics}.test.ts` | clock determinism + split-metric assertions | Coverage gaps |
| `evals/results/2026-06-28-{curated,no-semantic}.{md,json}` | regenerated, mode-stamped | The numbers themselves |
| `docs/2026-06-28-eval-parity-split.md` | standalone write-up | — |

**Reproduce in ~3 min (semantic cached):**
```bash
cd ~/devprojects/obsidian-mcp-server
npm test && npm run build
node scripts/memory-eval.mjs --vault work                 # curated → results/2026-06-28-curated.md
node scripts/memory-eval.mjs --vault work --no-semantic   # → results/2026-06-28-no-semantic.md
```
Then read `evals/results/2026-06-28-curated.md` (headline query-pin **85.8%**, the two routing
tables, the three pin tiers) and `…-curated.json` → `pinAnalysis`.

**Specific things I want you to challenge:**
1. **Harmful-pin definition.** I split harmful into severe (expected note dropped from top-k) vs
   mild (demoted from rank 1, recall preserved). Is rank-1 demotion really "harmful," or should
   only top-k drops count? `observability-migration` is the only case and it's the mild kind — so this
   choice decides whether the harness reports 1 harmful pin or 0.
2. **Faithful baselines.** Topic-path routing for `get_brief` (explicit topic arg) vs query-path
   for `hybrid_search` (raw query). Agree these are the right two faithful baselines, or is there
   a third path I'm not modeling?
3. **`EVAL_EPOCH` = 2026-06-28.** Fixed-epoch keeps recency ranking realistic for the snapshot and
   deterministic. Any failure mode you'd flag (e.g. new notes created after the epoch getting the
   age-0 boost)?
4. **Is the harness now trustworthy enough** to move to telemetry + the ~100-case expansion, or is
   there a measurement hole still open before we tune anything?

---

## Update 6 — your sign-off + naming fix (harm → retrieval regression)

You signed off on the substance ("solid measurement harness… doing its job") and gave a naming
push I took: **the metric measures retrieval regression *relative to raw RRF*, not all user
harm** — so I renamed it rather than letting "harmful: 1" get quoted out of context.

- **Renamed** the umbrella `Harmful wrong pins` → **`Pin-induced retrieval regression (vs raw
  RRF)`**, keeping your two tiers: **severe** (expected note dropped from top-k) and **mild
  (ranking)** (demoted from rank 1, still in top-k). For `observability-migration`: **0 severe, 1
  ranking** — the honest headline is "no answer lost, one answer demoted a slot." JSON
  `pinAnalysis` keys renamed to match (`pinRegressions`, `severeRegressionIds`,
  `rankingRegressionIds`); invariant now `regression ≤ applied ≤ wrongRoutes`.
- **Fixed the `--no-semantic` wording** you flagged: applied pins *can* come from keyword-only
  candidates, so it's not "requires semantic" — it's **"suppressed in no-semantic"** (a choice, so
  that mode stays a clean keyword/routing diagnostic). Reworded everywhere.

**Recorded as deferred (your "later" list — not built):**
- **Misleading-first-context metric:** an applied wrong pin at **rank 1 regardless of whether raw
  had an expected note there** — doesn't move recall, but a wrong brief as the agent's *first*
  context can still mislead. A distinct safety metric to add with telemetry.
- **Observed-agent-query baseline:** a third faithful path from `hybrid_search` telemetry — real
  agents phrase queries differently than my fixture.
- **`EVAL_EPOCH`:** staying fixed as snapshot-time; I'll repin (new baseline) only if I add many
  future-dated cases. No clamp.

**Agreed direction, locked:** next work is **`hybrid_search` telemetry**, then grow to ~100 cases
from real queries. **No more retrieval changes; no NL-routing tuning yet.** Thanks — this closes
the eval-hardening arc; the harness is doing its job and the next move is observation, not tuning.
