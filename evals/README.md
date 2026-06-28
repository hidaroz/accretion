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

- **Keyword / Semantic precision@k & recall@k** — of the top-k retrieved notes vs `expectedNotes`.
- **Brief routing accuracy** — did `get_brief(topic)` resolve to `expectedBrief` (direct_map → tag_search → none)?
- **Misses** — per-case list of what fell short (the actionable signal).

## How to use it

- **Expand the seed**: ~12 cases ship here; grow to 20–50 covering your real recurring questions, with the notes you'd expect a good answer to cite.
- **Re-run after any change** to retrieval, conventions, brief-map, or chunking. **A drop is a regression** — treat the committed scorecards as a baseline.
- **Gate autonomy on it**: per the review, any future move to re-enable narrow auto-apply should be justified by measured behavior here, not confidence labels.
