# Design review: a curated, agent-maintained memory system

*Author: Hidar Elhassan · Status: working system, seeking critique*

I built a memory system for AI coding agents and I want a senior pair of eyes on the
**design choices and where they break** — not a code review. Below is the thesis, the
architecture, the decisions with their tradeoffs, what's validated, what's weak, and the
specific questions I want your judgment on. Push hard; I'd rather find the flaws now.

## The problem

Coding agents are stateless across sessions. The "memory" products (Mem0, Zep, Letta)
solve this by auto-extracting facts into a vector/graph store the agent owns and the human
never reads. That works for a product adding memory via an API. It doesn't fit what I
actually wanted: a **legible, owned, version-controlled knowledge base that compounds**,
that *I* curate and my agents both read and maintain — for real production work (a
client platform, and soon a contract role where IP locality matters).

## Thesis

Treat memory as a **curated markdown lifecycle**, not a vector dump:
`sessions → digests → briefs → staleness → proposals → apply → archive/resurface`.
Human-readable, git-versioned (git-crypt encrypted), local-first, and served to agents over
MCP. The human and the agent read/write the **same store**.

## Architecture (brief)

- **MCP server** (TypeScript/Express): ~20 tools over HTTP, multi-vault. Keyword index
  (MiniSearch) + local semantic index (transformers.js, `all-MiniLM-L6-v2`, cosine),
  both kept live by a file watcher.
- **Vaults**: Obsidian markdown + YAML frontmatter, one git repo per project, git-crypt.
- **Capture**: a Claude Code `SessionEnd` hook writes a session note per work session,
  routed `cwd → project-map → vault`.
- **Lifecycle**: weekly the system synthesizes per-project digests, detects stale briefs
  (curated references whose subject saw new activity since last review), proposes structured
  edits, **auto-applies high-confidence ones**, archives covered sessions, and queues
  evergreen notes for spaced review.
- **Autonomy**: macOS launchd runs the weekly pass unattended via headless `claude -p`,
  commits + pushes, writes a run report, notifies.

## Key decisions & tradeoffs (this is what I want reviewed)

1. **Markdown + git over a vector DB.** Gains: human-readable, diffable, portable,
   encryptable, no infra. Costs: no native semantic store (I bolted on a local embedding
   index), and retrieval quality is my responsibility, not a vendor's.

2. **A curation lifecycle over auto-accumulation.** Most systems just append facts. I add
   decay (staleness), synthesis (digests), and review (resurface). Gain: the store stays
   high-signal and self-pruning. Cost: real complexity, and it only pays off if the loop
   actually runs — which is why I automated it.

3. **Local embeddings, no API.** `all-MiniLM-L6-v2` via transformers.js — nothing leaves
   the machine (matters for IP-sensitive contexts). Cost: first build is slow (~3 min/vault,
   backgrounded + cached), and quality is below hosted models.

4. **Hybrid retrieval + a hand-maintained brief-map.** Curated briefs (keyword-routed) +
   MiniSearch + semantic. The brief-map (keyword→brief) is hand-curated. Gain: precision on
   the queries that matter. Cost: maintenance burden; possible dead-end at scale.

5. **Auto-applying LLM-generated edits to the knowledge base.** The weekly run edits briefs
   itself when confident (`confidence: high`), leaves the rest as proposals. Safeguards:
   structured deterministic edits, git-revertibility, a run report, and an audit banner.
   This is the decision I'm least sure about.

6. **Each autonomous run is a fresh LLM with no memory** — it sees only the vault on disk.
   So I made state self-evident in the files (status flags, `[!done]` banners, exact source
   lists). "Every artifact is a message to a stranger, because the next run is one."

7. **Fixed conventions over configurability.** Folder/tag layout is load-bearing in the
   server; new vaults must conform. Gain: simplicity. Cost: rigidity.

## What's validated

- The autonomous weekly run works end-to-end (synthesized 6 digests, auto-applied 1 brief
  correctly, archived 102 sessions, committed + pushed, all unattended).
- 317 unit tests; deterministic edit logic is well covered.
- **Dogfooding found two real bugs** the tests missed (a heading-level mismatch in the edit
  engine; a stale-state report from a fresh run) — both fixed. The system now documents its
  own architecture in a vault it maintains.

## Known weaknesses (my own list — add to it)

- **LLM-driven curation is non-deterministic.** Staleness judgment and digest quality vary
  run to run. The H3 bug escaped because my tests only used one heading level.
- **No quality metric.** I can't measure whether the memory actually improves agent output.
- **Brief-map is hand-maintained.** Scales poorly; arguably should be semantic.
- **Retrieval is decent, not SOTA.** Note/section-level embeddings, no reranking in the
  context-assembly path.
- **Autonomy is laptop-shaped** (launchd; needs the machine awake).
- **Single-user, bespoke.** Conventions are rigid; not packaged.

## Questions I want your judgment on

1. **Over-engineering check:** Is the curation lifecycle worth it, or would
   RAG-over-everything + periodic summarization get 80% of the value at 20% of the
   complexity? Where am I adding ceremony that doesn't earn its keep?
2. **Auto-apply safety:** Is letting an LLM edit a trusted knowledge base unattended
   defensible with confidence-gating + git-revert + audit trail — or is "human approves
   every write" the only sane bar, and I'm fooling myself?
3. **The "fresh LLM each run, files-as-state" model:** sound foundation, or a smell that
   I'm pushing coordination into markdown that belongs in a real datastore?
4. **Scale:** what breaks first at 5k / 50k notes? (Brute-force cosine, in-memory keyword
   index, the MOC/orphan graph model, the hand-maintained brief-map?)
5. **Evaluation:** how would *you* measure whether this memory helps — offline retrieval
   metrics, task-level A/B, something else? Without this I'm flying blind.
6. **Product vs tool:** is there a real product here (the lifecycle is the differentiator
   vs Mem0/Zep), or is this destined to stay a personal power-tool? If product, what's the
   wedge?

## What I'm asking you to decide

Tell me: where I'm over- or under-engineering, what breaks at scale, whether the auto-apply
model is sound, and the single highest-leverage change you'd make. Blunt is better.

## Review outcome (adopted)

A senior review landed the key reframe: *the differentiator is memory governance, not
retrieval; and the unsafe part isn't auto-apply — it's auto-apply without a measurable
memory-quality loop.* Changes made in response:

1. **Propose-only.** Brief-content edits are semantic, so confidence-gated unattended
   auto-apply was removed. The weekly run now **proposes** every brief change; a human
   reviews and applies (`apply_brief_proposal`). `confidence` is a triage hint, not a
   trigger. Deterministic housekeeping (digests, `last_reviewed` stamps, archive) stays
   automatic. (docs ADR-007.)
2. **A measurable loop.** Added a deterministic eval harness (`evals/`, `scripts/memory-eval.mjs`):
   precision/recall@k for keyword + semantic retrieval and brief-routing accuracy against
   known-answer cases, with committed scorecards. First run already surfaced that NL queries
   under keyword search bury briefs (routing recovers them). (docs ADR-008.)
3. **Deferred deliberately:** LLM-judge answer quality; a *re-introduced* narrow,
   kind+invariant, **eval-gated** auto-apply lane (earn autonomy back with measurement);
   a run ledger before any multi-writer use; ANN indexing (~50k chunks).

The north star from the review: any future automation is gated on measured behavior, not
confidence labels.
