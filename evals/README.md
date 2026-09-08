# Memory-quality evals

A deterministic harness that measures whether the memory actually retrieves and
routes well — the measurable loop a senior review flagged as the prerequisite for
trusting any autonomy. No LLM; pure retrieval + routing metrics against
known-answer cases.

## Run

```bash
npm run build                                    # the harness imports dist/
accretion eval --vault demo                      # full (builds the embedding model once)
accretion eval --vault demo --no-semantic        # fast: keyword + routing only
accretion eval --vault demo --faithful           # semantic index over all notes, incl. raw sessions
accretion eval --vault demo --sweep-routing      # floor/margin grid for calibration
# flags: --k 5 (cutoff), --cases evals/cases.jsonl; EVAL_EPOCH pins the frozen clock
```

Writes `evals/results/{date}-{mode}.md` (+ `.json`) and prints a scorecard. CI runs the
no-semantic mode against `.github/ci-vaults.json`, which points at `demo-vault/`.

**Scope & performance:** the semantic index covers **curated notes** (briefs, digests, knowledge) and excludes raw session journals, which are slow to embed and not the target of brief-recall cases. The engine now does the same by default: retrieval walkers skip `sessions/archive/`, and a vault's `semantic: "auto"` turns embeddings on only once the curated layer is large enough. `--faithful` indexes everything for a production-shaped number. Vectors are cached in the vault's `.mcp/embeddings.json`, so the first semantic run is slow (cold embed) and later runs are fast.

## Case format (`cases.jsonl`, one JSON object per line)

```json
{ "id": "auth-otp",
  "query": "how does login with OTP work",   // natural-language → drives search + semantic
  "topic": "auth",                              // keyword → drives `accretion brief` routing (optional; defaults to query)
  "expectedNotes": ["03-Architecture/brief-auth-rbac.md"],  // vault-relative paths that SHOULD be retrieved
  "expectedBrief": "03-Architecture/brief-auth-rbac.md",     // brief routing should resolve to (or null)
  "note": "optional rationale" }
```

## Metrics

For each retrieval mode — **keyword**, **semantic**, and **hybrid (RRF fusion)**:
- **recall@k** — fraction of expected notes in the top-k.
- **success@k** — did ≥1 expected note land in top-k (what matters for agent context assembly).
- **MRR** — reciprocal rank of the first hit (did the best source appear early enough?).
- precision@k is computed but de-emphasized — with 1–2-note expected sets it's capped low and punishes helpful supporting context.

Plus:
- **Brief routing accuracy** (positives) — did routing the `topic` (what `accretion brief` does) resolve to `expectedBrief`? The query path, what `accretion search` and the recall hook route on, is reported separately; see `docs/EVAL-PARITY.md`.
- **Negative-routing accuracy** — for `negative: true` cases (off-domain queries), did routing correctly return *no* brief? Low here = false-positive routing (the fuzzy fallback over-matching).
- **Verdict** — hybrid is a WIN only if it beats both singles on recall@k *and* MRR, with routing preserved and stable across reruns.
- **Misses** — per-case list of what fell short (the actionable signal).

Negative cases: `{ "id", "query", "topic", "expectedNotes": [], "expectedBrief": null, "negative": true, "stratum": "off-domain-neg" }`.

## Routing precision & calibration

Routing prefers **"no brief" over a plausible-but-wrong one**. The fuzzy `tag_search` fallback must clear a score `floor` AND beat #2 by a `marginRatio`, and carry a token tying it to that brief (a keyword, title or slug token), else it abstains (`src/engine/retrieval/brief-routing.ts`). `direct_map` and exact-title routes bypass the gate. Routing keywords come from each brief's `keywords:`/`aliases:` frontmatter merged with `.mcp/brief-map.json`.

- **Calibrate:** `accretion eval --vault demo --sweep-routing` prints precision/recall/abstention/neg-accuracy across a `(floor, marginRatio)` grid. Pick the conservative high-precision point by inspection; bake into `DEFAULT_FLOOR` / `DEFAULT_MARGIN_RATIO`. (Scores are MiniSearch-relative → may need per-vault tuning.)
- **Routing precision** (of routed) is the headline; **negative-routing accuracy** is the false-positive guard. Goal: high precision without crushing positive routing recall.

## Strata, CIs, and the two-tier eval

- Cases carry a `stratum` (`direct-name`, `nl`, `terse-acronym`, `off-domain-neg`, `near-domain-neg`); the scorecard breaks success/neg-accuracy down by stratum.
- The scorecard reports a **95% bootstrap CI** (seeded → reproducible) on hybrid recall — small samples swing, so don't over-read point estimates.
- **Fast tier (default):** curated-only semantic index, runs every change. **Faithful tier:** `--faithful` indexes all notes (incl. raw sessions), mirrors production — slower, run before release. Divergence between the two is itself a signal.

## How to use it

- **Expand the seed**: 90 cases ship here, written against `demo-vault/`. For your own vault, replace them — grow to 50+ covering the questions you actually ask, with the notes you'd expect a good answer to cite. Keep the negative strata; they are what stops you tuning yourself into a system that always answers and is sometimes confidently wrong.
- **Re-run after any change** to retrieval, routing, the tokenizer stop list, conventions, brief keywords, or chunking. **A drop is a regression** — treat the committed scorecards as a baseline.
- **Gate autonomy on it**: per the review, any future move to re-enable narrow auto-apply should be justified by measured behavior here, not confidence labels.


## Task-level eval: does the vault make answers better?

Retrieval metrics say whether the right note comes back. They cannot say whether an agent
answered better because of it. `accretion task-eval` measures that directly.

A case is a question, a gold answer written by the vault's owner, the notes a good answer
draws on, and a stratum (`factual`, `rationale`, `procedural`, `negative`). Each case is
answered under three conditions through `claude -p`, so the eval spends your Claude Code
subscription and, for the last condition, exercises the real product surface:

| Condition | What the agent gets |
|---|---|
| `bare` | the question only; every tool and MCP server denied |
| `recall` | the passive-recall block the hook would inject, ahead of the question; no tools |
| `plugin` | the installed plugin: skill, recall hook, `accretion` on PATH (`Bash(accretion *)` and `Read` only) |

A blind judge (also `claude -p`, structured output) scores every answer against the gold:
correctness 0-2, grounding 0-2, fabrication 0/1, abstained. It runs twice per case with the
answers shuffled, so position bias cancels: a condition **wins** a case only when it beats
the baseline in both passes, **loses** only when below in both, and ties otherwise. The
scorecard reports win rate with a bootstrap CI, per stratum, and lists every loss with the
judge's reason. Negative cases score abstention: an agent that invents vault-specific
guidance for a question the vault does not cover is the failure this tier exists to catch.

```bash
accretion task-eval --vault demo --dry-run          # what would run, spend nothing
accretion task-eval --vault demo                     # 22 cases × 3 conditions + 2 judge passes
accretion task-eval --vault demo --only task-why-rrf,task-neg-pinecone
accretion task-eval --vault demo --conditions bare,recall --model sonnet --judge-model opus
accretion task-eval --vault work --include-drafts     # private cases from <vault>/.mcp/task-cases.jsonl
```

Answers and judgments are cached under the output directory (`task-cache/`), so adding a
case or re-judging (`--rejudge`) spends only on what is new; `--fresh` discards both. Demo
results land in `evals/results/`; any other vault's results stay inside the vault under
`.mcp/task-eval/`, because answers quote its content. Capture is switched off for eval
sessions (`ACCRETION_CAPTURE=off`), so runs never write session notes into the vault.

Writing cases: `evals/tasks.jsonl` is the demo set. For your own vault, write
`<vault>/.mcp/task-cases.jsonl` in the same shape, mark unreviewed ones `"draft": true`
(skipped unless `--include-drafts`), and keep at least three negatives. Twenty real
questions you have actually asked beat a hundred synthetic ones.
