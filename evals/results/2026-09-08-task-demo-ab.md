# Task eval scorecard: 2026-09-08

vault: `demo` · cases: 22 (19 pos / 3 neg) · judge passes: 2 (answers shuffled per pass) · baseline: `bare` · model: default · judge: default · seed: 42 · 2026-09-08T03:16:34.807Z

A condition **wins** a case only when the judge ranks it above the baseline in every pass; **loses** only when below in every pass; anything else is a tie. Win rate is wins over judged cases, with a 95% bootstrap CI.

## Conditions
| Condition | correctness (0-2) | grounding (0-2) | unsupported (vs sources) | contradicted | fabrication (vs gold) | fully correct | pos. abstain | neg. abstain | neg. clean abstain | win / tie / loss vs baseline | win rate | 95% CI | latency | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bare | 0.48 | 0.05 | **0.0%** | 0.0% | 0.0% | 5.3% | 89.5% | 100.0% | 100.0% | — | — | — | 11.3s | 0 |
| **recall** | 1.59 | 1.68 | **4.5%** | 4.5% | 6.8% | 63.2% | 10.5% | 100.0% | 100.0% | 20 / 1 / 1 | 90.9% | [77.3%, 100.0%] | 8.6s | 0 |
| **plugin** | 1.98 | 2.00 | **22.7%** | 9.1% | 15.9% | 100.0% | 0.0% | 100.0% | 66.7% | 21 / 1 / 0 | 95.5% | [86.4%, 100.0%] | 13.4s | 0 |

"unsupported (vs sources)" comes from a second judge pass that sees the case's source notes; "fabrication (vs gold)" is the comparative judge, which sees only the reference answer and so also flags true vault facts the reference omits.

## Recall condition by tier
| Tier | n | correctness | unsupported |
|---|---|---|---|
| brief | 15 | 2.00 | 6.7% |
| hits | 6 | 0.83 | 0.0% |
| none | 1 | 0.00 | 0.0% |

## Per stratum
| Stratum | n | bare correctness | recall correctness | plugin correctness | recall win rate | plugin win rate |
|---|---|---|---|---|---|---|
| factual | 8 | 0.50 | 1.75 | 2.00 | 100.0% | 100.0% |
| negative | 3 | 1.50 | 2.00 | 1.83 | 100.0% | 66.7% |
| procedural | 5 | 0.10 | 1.20 | 2.00 | 80.0% | 100.0% |
| rationale | 6 | 0.25 | 1.50 | 2.00 | 83.3% | 100.0% |

## Cases where a condition lost to the baseline (1)
- `task-apply-proposal` [procedural] lost with recall: B matches the reference in substance (human applies via --apply or apply_brief_proposal, H1–H6 matching, replace-throws/append-creates-##/pre-heading unreachable, manual-flag restated in reports) with only a minor command-name variant; A and C both abstain, with A ranked ahead as the shorter abstention.

## Unsupported claims (6 cases)
- `task-rrf-constant` [factual] plugin:
  - Neither the session demotion nor the pinning adjustment involves k [unsupported]
- `task-why-abstain` [rationale] plugin:
  - The vault's brief routing note is titled "Brief routing — confidence gates and abstention" [unsupported]
- `task-apply-proposal` [procedural] plugin:
  - The apply command is `accretion apply-proposals --apply` [contradicted]
- `task-brief-map-entry` [procedural] plugin:
  - The direct map is the only route with no confidence gate/threshold. [contradicted]
  - The vault does not state the exact JSON shape of the brief-map file. [contradicted]
- `task-sourdough-timing` [factual] recall:
  - If the starter isn't that active, the bulk will be slow regardless of temperature [unsupported]
  - The note doesn't go further into diagnosing a sluggish starter [contradicted]
- `task-neg-sharding` [negative, neg] plugin:
  - The ANN growth path is still a single-machine change [unsupported]
  - The documented answer to a big vault is to prune what gets embedded or eventually add ANN locally [unsupported]

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
| `task-why-demote-sessions` | rationale | 0.00 | 0.00 | 2.00 | recall: tie, plugin: win |
| `task-why-no-autoapply` | rationale | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-why-floor-low` | rationale | 0.50 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-why-abstain` | rationale | 0.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-why-dry-run` | rationale | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-onboard-vault` | procedural | 0.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-weekly-steps` | procedural | 0.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-apply-proposal` | procedural | 0.00 | 0.00 | 2.00 | recall: loss, plugin: win |
| `task-brief-map-entry` | procedural | 0.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-first-run-check` | procedural | 0.50 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-sourdough-timing` | factual | 1.00 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-chain-replace` | factual | 2.00 | 1.00 | 2.00 | recall: win, plugin: win |
| `task-neg-finetune` | negative (neg) | 2.00 | 2.00 | 1.50 | recall: win, plugin: tie |
| `task-neg-sharding` | negative (neg) | 1.50 | 2.00 | 2.00 | recall: win, plugin: win |
| `task-neg-pinecone` | negative (neg) | 1.00 | 2.00 | 2.00 | recall: win, plugin: win |
