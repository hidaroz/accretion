# Task eval scorecard: 2026-09-08

vault: `demo` · cases: 22 (19 pos / 3 neg) · judge passes: 2 (answers shuffled per pass) · baseline: `bare` · model: default · judge: default · seed: 42 · 2026-09-08T03:01:34.154Z

A condition **wins** a case only when the judge ranks it above the baseline in every pass; **loses** only when below in every pass; anything else is a tie. Win rate is wins over judged cases, with a 95% bootstrap CI.

## Conditions
| Condition | correctness (0-2) | grounding (0-2) | unsupported (vs sources) | contradicted | fabrication (vs gold) | fully correct | pos. abstain | neg. abstain | neg. clean abstain | win / tie / loss vs baseline | win rate | 95% CI | latency | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | 0.50 | 0.09 | **9.1%** | 9.1% | 0.0% | 5.3% | 89.5% | 100.0% | 100.0% | — | — | — | 11.3s | 0 |
| **recall** | 1.59 | 1.66 | **13.6%** | 4.5% | 2.3% | 63.2% | 21.1% | 100.0% | 100.0% | 19 / 0 / 3 | 86.4% | [72.7%, 100.0%] | 8.3s | 0 |
| **plugin** | 1.98 | 1.98 | **9.1%** | 0.0% | 15.9% | 100.0% | 0.0% | 100.0% | 66.7% | 21 / 0 / 1 | 95.5% | [86.4%, 100.0%] | 13.9s | 0 |

"unsupported (vs sources)" comes from a second judge pass that sees the case's source notes; "fabrication (vs gold)" is the comparative judge, which sees only the reference answer and so also flags true vault facts the reference omits.

## Recall condition by tier
| Tier | n | correctness | unsupported |
|---|---|---|---|
| brief | 15 | 2.00 | 13.3% |
| hits | 6 | 0.83 | 16.7% |
| none | 1 | 0.00 | 0.0% |

## Per stratum
| Stratum | n | bare correctness | recall correctness | plugin correctness | recall win rate | plugin win rate |
|---|---|---|---|---|---|---|
| factual | 8 | 0.56 | 1.75 | 2.00 | 87.5% | 100.0% |
| negative | 3 | 1.50 | 2.00 | 1.83 | 100.0% | 66.7% |
| procedural | 5 | 0.00 | 1.20 | 2.00 | 80.0% | 100.0% |
| rationale | 6 | 0.33 | 1.50 | 2.00 | 83.3% | 100.0% |

## Cases where a condition lost to the baseline (4)
- `task-why-demote-sessions` [rationale] lost with recall: B matches the reference on every point (volume/verbosity, path-based demotion in fusion, still retrievable, digests exempt); A cleanly abstains; C abstains but then asserts an unsupported curated-only-embedding explanation that contradicts the reference's explicit path-based demotion.
- `task-apply-proposal` [procedural] lost with recall: B matches the reference on every point (human apply via the script or tool, H1–H6 heading reach, the three limits, and manual-flagging in run reports) with vault-specific detail; A and C both abstain without content, A being shorter.
- `task-chain-replace` [factual] lost with recall: A reproduces the vault brief's thresholds, checking interval, cassette-reshaping mechanism and 2–3 chain lifespan; B gets the substance right but explicitly as generic advice; C hedges heavily, omits the 0.75% wider-chain threshold and skipping consequence, and mischaracterises the 0.75% case.
- `task-neg-finetune` [negative] lost with plugin: All three abstain, but A does so plainly while correctly pointing to the vault's actual structure, B abstains generically, and C, despite saying fine-tuning isn't documented, goes on to supply vault-specific swap/cache/eval guidance the reference warns against.

## Unsupported claims (6 cases)
- `task-rrf-constant` [factual] recall:
  - k is the only tuning parameter in play in the fusion [unsupported]
- `task-routing-thresholds` [factual] recall:
  - The vault these values are calibrated against is named "demo" [unsupported]
- `task-why-demote-sessions` [rationale] recall:
  - The reason raw session notes get pushed down is the curated-only embedding policy (they only surface via keyword search), rather than an explicit demotion rule [contradicted]
- `task-why-demote-sessions` [rationale] plugin:
  - The hybrid retrieval brief is in the demo vault [unsupported]
  - The 2026-W29 digest records both fixes [unsupported]
- `task-why-dry-run` [rationale] plugin:
  - The note states the fresh-model/no-memory property as a reason for the dry-run default (an unsupervised mutating run has no context from earlier runs to check itself against). [unsupported]
- `task-sourdough-timing` [factual] bare:
  - Look for roughly 50–75% volume increase as the readiness target [contradicted]
- `task-chain-replace` [factual] bare:
  - The question of when to replace a bike chain and why waiting costs more is not covered by / not specific to this project's notes [contradicted]

## Per case
| Case | stratum | bare | recall | plugin | outcome |
|---|---|---|---|---|---|
| `task-rrf-constant` | factual | 1.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-routing-thresholds` | factual | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-embedding-cache` | factual | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-capture-records` | factual | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-archive-invariant` | factual | 0.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-embedding-model` | factual | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-why-rrf` | rationale | 1.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-why-demote-sessions` | rationale | 0.00 | 0.00 | 2.00 | recall: loss, plugin: win |
| `task-why-no-autoapply` | rationale | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-why-floor-low` | rationale | 1.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-why-abstain` | rationale | 0.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-why-dry-run` | rationale | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-onboard-vault` | procedural | 0.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-weekly-steps` | procedural | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-apply-proposal` | procedural | 0.00 | 0.00 | 2.00 | recall: loss, plugin: win |
| `task-brief-map-entry` | procedural | 0.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-first-run-check` | procedural | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-sourdough-timing` | factual | 1.50 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-chain-replace` | factual | 2.00 | 1.00 | 2.00 | recall: loss, plugin: win |
| `task-neg-finetune` | negative (neg) | 2.00 | 2.00 | 1.50 | recall: win, plugin: loss |
| `task-neg-sharding` | negative (neg) | 1.50 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-neg-pinecone` | negative (neg) | 1.00 | 2.00 | 2.00 | recall: win, plugin: win |
