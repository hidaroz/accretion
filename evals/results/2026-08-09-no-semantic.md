# Memory eval scorecard — 2026-08-09

vault: `demo` · cases: 90 (77 pos / 13 neg) · k: 5 · mode: `no-semantic` · semantic: off · clock: 2026-08-01T00:00:00.000Z (frozen) · 2026-08-09T20:52:41.141Z

## Retrieval
| Mode | recall@5 | success@5 | MRR |
|---|---|---|---|
| Keyword | 97.4% | 97.4% | 0.832 |
| Semantic | — | — | — |
| Hybrid raw (no pin) | — | — | — |
| **Hybrid query-pin (live)** | — | — | — |
| Hybrid topic-pin (diagnostic) | — | — | — |

Headline **query-pin** mirrors live `hybrid_search` (pins the brief routed from the raw query). **topic-pin** pins from the clean `topic` keyword the eval supplies but real callers don't — the topic-pin − query-pin gap is harness assistance, not product behavior.

Parity delta (topic-pin − query-pin) recall@5: — · success@5: —

Hybrid query-pin recall@5 95% CI: — (suppressed in no-semantic)

## Brief routing — topic path (faithful to `get_brief`)
`get_brief` takes an explicit topic argument, so this measures routing on the `topic` keyword. Precision over recall — abstain beats wrong.
| Metric | Score |
|---|---|
| Routing precision (of routed) | **98.7%** |
| Routing recall (positives routed correctly) | 100.0% |
| Abstention rate | 13.3% |
| Negative-routing accuracy | **92.3%** |

## Brief routing — query path (live `hybrid_search` pin source)
Live `hybrid_search` routes/pins on the raw **query**. A wrong route only *applies* as a pin if the routed brief was retrieved (rrf ignores unretrieved pins), and only causes a *retrieval regression* if that pin displaces an expected note **relative to raw RRF**. Subset chain — regression ⊆ applied ⊆ wrong-routes. NB: this measures retrieval regression vs raw RRF, not all possible user harm (a wrong pin at rank 1 can mislead first context even when recall is unchanged — tracked separately, later).
| Metric | Score |
|---|---|
| Routing precision (of routed) | **92.0%** |
| Routing recall (positives routed correctly) | 29.9% |
| Abstention rate | 72.2% |
| Negative-routing accuracy | **100.0%** |
| Wrong query routes (route ≠ expected brief) | **2** |
| ↳ Applied wrong pins (route was retrieved → pinned) | — (suppressed in no-semantic) |
| ↳ Pin-induced retrieval regression (vs raw RRF) | — (suppressed in no-semantic) |
| &nbsp;&nbsp;&nbsp;• severe — expected note dropped from top-5 | — (suppressed in no-semantic) |
| &nbsp;&nbsp;&nbsp;• mild (ranking) — demoted from rank 1, still in top-5 | — (suppressed in no-semantic) |

Wrong-route cases: `retr-two-indexes`, `dig-archive-rule`

## Per-stratum
| Stratum | n | query-pin success@5 | neg-routing acc |
|---|---|---|---|
| direct-name | 4 | — | — |
| near-domain-neg | 5 | — | 80.0% |
| nl | 65 | — | — |
| off-domain-neg | 8 | — | 100.0% |
| terse-acronym | 8 | — | — |

## Misses (—)
- (hybrid misses require semantic; re-run without --no-semantic)
