# The measurement story

This started as a response to an external design review. A senior engineer read the system
when it had a confidence-gated auto-apply lane and no way to tell whether any of it worked,
and made one argument that reshaped the design:

> The unsafe part isn't auto-apply itself; it's auto-apply without a measurable
> memory-quality loop.

What follows is what that argument produced, in order. It is kept because the *sequence*
matters more than any individual number: nearly every improvement here came from a
measurement contradicting an assumption, and several came from measurements that turned out
to be measuring the wrong thing.

The reviewer is credited by role at their preference. Their through-line throughout:
**measure before automating, abstain over wrong, defer until proven.**

> **On the numbers.** Earlier rounds were measured against a private vault that is not
> distributable, so those figures are not reproducible by a reader and are not quoted here.
> Findings from that period are described by what they showed, not by a number nobody can
> check. Every figure in this document is from `demo-vault/`, which ships with the repo, and
> can be regenerated with the commands at the end.

---

## 1. Auto-apply removed, not narrowed

The review asked for the auto-apply lane to be narrowed hard. It was removed instead.

Brief edits are semantic judgments, so confidence-gating was the risk rather than the
mitigation. The weekly loop became **propose-only**: it writes structured proposals and
stops; a human applies them. `confidence` was demoted from a trigger to a triage hint.
Deterministic housekeeping — digests, `last_reviewed` stamps, archiving — stayed automatic.

The reasoning that made removal preferable to narrowing: a wrong brief edit does not throw.
Retrieval keeps returning the corrupted brief with unchanged confidence, silently poisoning
every future answer on that topic, and the source sessions may be archived before anyone
questions it. There is no error to catch.

## 2. The eval came before more autonomy

A deterministic harness, no LLM judge: known-answer cases scoring keyword, semantic and
fused retrieval, plus routing precision. Pure metric functions, unit-tested, committed
scorecards.

The first baseline's value was not its headline but its **miss structure**. Natural-language
queries were retrieved by semantic and missed entirely by keyword, which buried briefs under
sessions. A handful of terse, identifier-heavy briefs were the exact inverse — keyword found
them, semantic lost them to their neighbours.

That is a measured statement that the two methods fail independently, which is the
precondition for fusion helping. It turned "we should probably add hybrid search" into a
prediction that could be wrong.

## 3. A scaling prediction that bit immediately

The review flagged in-memory brute-force cosine as a future break point. It arrived at once:
a cold embed over the full vault including raw session journals ran past fifteen minutes
single-threaded.

Scoping the semantic index to curated notes and caching vectors to disk fixed it, and turned
out to improve quality too — raw sessions are verbose and repetitive, and embedding them
floods every query's semantic neighbourhood with near-duplicate transcript. A stopgap that
was also correct.

## 4. Fusion, and what the negatives exposed

RRF fusion beat both single methods on recall and MRR, reproducibly. That part went as
predicted.

The negative cases — queries with no right answer, added at the reviewer's insistence —
exposed something nobody was looking for: **routing returned a brief for almost any input.**
Off-domain questions with nothing to do with the vault confidently resolved to whichever
brief scored least badly. The fuzzy fallback had no notion of "nothing matches".

This was the single most valuable finding in the whole thread, and it came from test cases
whose expected answer was *nothing*. A suite made only of questions that have answers cannot
discover that a system never says "I don't know".

## 5. Threshold, then margin, then evidence

The first fix was a score floor. Insufficient: a query with no answer still clears an
absolute floor when everything scores low and one result scores least-low.

Adding a margin — the top hit must beat the runner-up by a ratio — helped and was still
insufficient, for the same reason one step removed. Both gates measure *relative* strength.
Neither establishes that the query is **about** the brief it routes to.

The fix that worked was a **domain trigger**: the query must contain a token tying it to
that specific brief — a brief-map keyword, a title word, a slug token. Intent over
proximity.

Deliberately *not* a floor bump. Raising the floor until nothing wrong routes also kills
every legitimate fuzzy route, and the system stops answering paraphrased questions, which is
most real questions. The trigger is the precision instrument; the floor is a coarse noise
filter. There is a live demonstration of the difference in the current scorecard — see §8.

## 6. Pinning: the system knew and didn't say

A separate failure, found by reading outputs rather than metrics: routing would correctly
identify the canonical brief while fusion simultaneously ranked it sixth, below sessions
that merely mentioned the topic. The system had the right answer and declined to show it.

Exact-match pinning places a confidently-routed brief into the result set rather than
letting it compete on rank — guarded so a pin only applies to a note some index actually
retrieved. Pinning an unretrieved note would assert relevance that no index found any
evidence for, which is the same error abstention exists to prevent.

## 7. The headline was an upper bound, not product behaviour

The most uncomfortable round. The reviewer distrusted a retrieval number that looked too
good, and was right for a reason that took a while to see.

The harness supplies each case a clean `topic` keyword alongside the query. Routing was
being evaluated on the **topic**. But live `hybrid_search` has no topic — it routes on the
**raw query**. The harness was quietly doing work at eval time that no real caller does, so
the headline described an upper bound the product could never reach.

Both paths are now reported separately:

- **topic-pin** — faithful to `get_brief`, which really does take an explicit topic argument
- **query-pin** — faithful to live `hybrid_search`, and the honest headline

The gap between them is labelled as harness assistance rather than product behaviour. A
measurement that flatters the system is worse than no measurement, because it is trusted.

## 8. Current scorecard

`demo-vault/`, 90 cases (77 positive / 13 negative), k=5, frozen clock. Regenerate with the
commands below.

| Mode | recall@5 | success@5 | MRR |
|---|---|---|---|
| Keyword | 97.4% | 97.4% | 0.832 |
| Semantic | 98.7% | 98.7% | 0.867 |
| Hybrid raw (no pin) | 97.4% | 97.4% | 0.922 |
| **Hybrid query-pin (live)** | **97.4%** | **97.4%** | **0.916** |
| Hybrid topic-pin (diagnostic) | 100.0% | 100.0% | 1.000 |

Query-pin recall@5 95% CI: **[93.5%, 100.0%]**. Parity delta (topic-pin − query-pin): 2.6%.

| Routing | topic path | query path |
|---|---|---|
| Precision (of routed) | **98.7%** | **92.0%** |
| Recall (positives routed) | 100.0% | 29.9% |
| Abstention rate | 13.3% | 72.2% |
| Negative-routing accuracy | **92.3%** | **100.0%** |

**These numbers are not comparable to the private vault's, and are not an improvement over
them.** A purpose-written 24-note corpus is an easier retrieval problem than a real vault
thick with raw sessions. Reading the jump as progress would be exactly the self-deception
this document exists to resist.

### The one failure, and why it stays

`nneg-finetune` — *"how do I fine tune an embedding model on my own corpus"* — routes to the
embedding-index brief. It should abstain: the query really is about embeddings, the brief
really is about the embedding index, and the specific question is uncovered. The domain
trigger cannot distinguish *about this subject* from *answered by this note*.

Contrast `vector database sharding`, which scores **higher** (47.3 vs 32.7) and correctly
abstains, because no token in it ties to any brief. That is the trigger working exactly as
designed, and it is why the fix is not a threshold.

`--sweep-routing` is flat across the entire grid, so the thresholds are unchanged. The reason
is worth stating plainly: **that case is the only one of 90 that routes via `tag_search` at
all** — every other route is `direct_map` or exact title. A floor above 32.7 would post 100%
negative accuracy at zero measured cost *here*, and would mean nothing, because this vault's
dense brief map leaves the fuzzy tier nearly dormant. On a sparsely-mapped vault that tier
carries real traffic and such a floor would gut it.

So the demo corpus **cannot honestly calibrate these thresholds**. That is a limitation of
synthetic fixtures, and stating it is better than quietly shipping a number bought by
over-fitting.

## 9. Known gaps

- **Answer quality is unmeasured.** Everything here is retrieval and routing. Whether a
  retrieved brief actually helped is not tested. An LLM-judge tier remains deferred.
- **A wrong pin at rank one can mislead even when recall is unchanged.** The retrieval
  metrics cannot see this. Tracked as real harm that goes unmeasured, not folded into a
  headline.
- **Thresholds are calibrated against one vault**, and per §8 this vault cannot calibrate
  them well. Transfer to other corpora is unevidenced.
- **Auto-apply stays removed.** If reintroduced, it should run in shadow mode for several
  cycles — recording what it *would* have applied against what a human approved — until the
  false-accept rate is demonstrably near zero. Not before.

## Reproducing

```bash
npm run build
node scripts/memory-eval.mjs --vault demo                 # full → evals/results/*-curated.md
node scripts/memory-eval.mjs --vault demo --no-semantic   # fast: keyword + routing
node scripts/memory-eval.mjs --vault demo --sweep-routing # floor/margin grid
```

`VAULTS_CONFIG` must point at a registry containing a `demo` vault at `demo-vault/`; see
`.github/ci-vaults.json` for the one CI uses. `EVAL_EPOCH` pins the frozen clock.
