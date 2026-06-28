# Memory-quality evals

A deterministic harness that measures whether the memory actually retrieves and
routes well — the measurable loop a senior review flagged as the prerequisite for
trusting any autonomy. No LLM; pure retrieval + routing metrics against
known-answer cases.

## Run

```bash
npm run build                                   # scripts import dist/
node scripts/memory-eval.mjs --vault work        # full (builds the embedding model once)
node scripts/memory-eval.mjs --vault work --no-semantic   # fast: keyword + routing only
# flags: --k 5 (cutoff), --cases evals/cases.jsonl
```

Writes `evals/results/{date}.md` (+ `.json`) and prints a scorecard.

**Scope & performance:** the semantic index covers **curated notes** (briefs, digests, knowledge) — it excludes the hundreds of raw session journals, which are slow to embed and not the target of brief-recall cases. (This diverges slightly from the server's all-notes semantic index; it's a deliberate eval-tractability choice.) Vectors are cached in the vault's `.mcp/embeddings.json`, so the first semantic run is slow (cold embed) and later runs are fast.

## Case format (`cases.jsonl`, one JSON object per line)

```json
{ "id": "auth-otp",
  "query": "how does login with OTP work",   // natural-language → drives search + semantic
  "topic": "auth",                              // keyword → drives get_brief routing (optional; defaults to query)
  "expectedNotes": ["03-Architecture/brief-auth-rbac.md"],  // vault-relative paths that SHOULD be retrieved
  "expectedBrief": "03-Architecture/brief-auth-rbac.md",     // brief get_brief should resolve to (or null)
  "note": "optional rationale" }
```

## Metrics

For each retrieval mode — **keyword**, **semantic**, and **hybrid (RRF fusion)**:
- **recall@k** — fraction of expected notes in the top-k.
- **success@k** — did ≥1 expected note land in top-k (what matters for agent context assembly).
- **MRR** — reciprocal rank of the first hit (did the best source appear early enough?).
- precision@k is computed but de-emphasized — with 1–2-note expected sets it's capped low and punishes helpful supporting context.

Plus:
- **Brief routing accuracy** (positives) — did `get_brief(topic)` resolve to `expectedBrief`?
- **Negative-routing accuracy** — for `negative: true` cases (off-domain queries), did routing correctly return *no* brief? Low here = false-positive routing (the fuzzy fallback over-matching).
- **Verdict** — hybrid is a WIN only if it beats both singles on recall@k *and* MRR, with routing preserved and stable across reruns.
- **Misses** — per-case list of what fell short (the actionable signal).

Negative cases: `{ "id", "query", "topic", "expectedNotes": [], "expectedBrief": null, "negative": true }`.

## How to use it

- **Expand the seed**: ~12 cases ship here; grow to 20–50 covering your real recurring questions, with the notes you'd expect a good answer to cite.
- **Re-run after any change** to retrieval, conventions, brief-map, or chunking. **A drop is a regression** — treat the committed scorecards as a baseline.
- **Gate autonomy on it**: per the review, any future move to re-enable narrow auto-apply should be justified by measured behavior here, not confidence labels.
