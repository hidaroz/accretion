Question: after Karpathy's April 2026 llm-wiki gist, how have named practitioners implemented file-based agent memory, what broke, and what does the 2025-2026 research on memory architectures and their evaluation say? Date: 2026-09-08.
Method: primary sources (gists, GitHub repos, blog posts, papers) gathered by a read-only research agent; anything from a snippet or paywall preview is marked [unverified].

# Report: File-Based Agent Memory (Part A) and Memory Architectures (Part B)

**Method note:** ~30 sources fetched directly. Where a claim comes only from a search snippet or a paywall preview, it is marked **[unverified]**. Where I could not find something the request assumed exists, I say so.

---

## Part A — The "LLM wiki" movement after Karpathy's gist

### A.0 The source artifact

Karpathy's gist (published April 2026) is a one-page spec, not code. Three layers: **raw sources** (immutable) → **wiki** (LLM-generated markdown) → **schema** (a `CLAUDE.md`-style conventions doc). Two special files: `index.md` (content-oriented catalog with links, one-line summaries, metadata) and `log.md` (append-only chronological record of ingests, queries, lint passes). Three operations: **ingest / query / lint**. It names Obsidian as the viewer, Marp for decks, Vannevar Bush's Memex as ancestry, and **qmd** as the retrieval tool.
https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Reception figures (5,000+ stars, 4,000+ forks within two weeks; Karpathy's own wiki reportedly ~100 articles / ~400,000 words) come from secondary write-ups only — the primary page I tried for these 404'd. **[unverified]**
https://www.cognitionus.com/blog/what-is-the-karpathy-llm-wiki-pattern (404 at fetch time)

### A.1 qmd — the search tool Karpathy points at

- **What:** "mini cli search engine for your docs, knowledge bases, meeting notes" — fully local. Author is GitHub user **`tobi`** (widely taken to be Tobias Lütke; the repo itself does not state a full name, so the identification is **[unverified]**).
- **Indexing:** documents chunked to ~**900 tokens with 15% overlap**, using a scoring algorithm to snap to natural markdown break points rather than hard token boundaries. Default embedding model **EmbeddingGemma-300M** (quantized), overridable via `QMD_EMBED_MODEL`. Full-text via **SQLite FTS5**; vectors in **sqlite-vec**. Fusion via **Reciprocal Rank Fusion** with position-aware blending. Reranking via **Qwen3-Reranker-0.6B** cross-encoder scoring 0.0–1.0.
- **Surface:** CLI (`search` keyword / `vsearch` semantic / `query` hybrid; plus `add`, `update`, `embed`, `get`, `multi-get`, `context add/list/rm`, `status`, `cleanup`, `doctor`) **and** an MCP server exposing `query`, `get`, `multi_get`, `status` over stdio and HTTP, with a daemon mode.
- **Numbers:** the README publishes **no** benchmark results or index-size figures.
https://github.com/tobi/qmd

Downstream: an Obsidian plugin wrapping it (https://github.com/achekulaev/obsidian-qmd), a TUI (https://alexanderzeitler.com/articles/introducing-lazyqmd-a-tui-for-qmd/), a skill packaging (https://github.com/levineam/qmd-skill/blob/main/SKILL.md), and independent MCP reimplementations (https://github.com/ehc-io/qmd, https://github.com/idanariav/qmd).

---

### A.2 Hadi Javeed — "I Tried Karpathy's LLM Knowledge Base. Here Is What Actually Worked."

**Important correction:** the **one-month report you asked for does not exist.** I enumerated the full sitemap (73 URLs) and both 2026 archive pages. The only relevant post is dated **2026-04-15** and explicitly says *"This system is days old"* and *"The real test is whether I am still using this in six months, not whether it works in the first week."* No update, addendum, or follow-up has been published as of 2026-09-07.
https://hadijaveed.me/2026/04/15/i-tried-karpathys-llm-knowledge-base/ · sitemap: https://hadijaveed.me/sitemap.xml · archive: https://hadijaveed.me/archive/2026/ and https://hadijaveed.me/archive/2026/page/2/

What it does contain:
- **Structure:** `personal-os/` with `_index.md` as master index; top-level `tasks.md`, `bookmarks.md`, `blogs.md`, `journal.md`; folders `learnings/`, `people/`, `projects/`, `concepts/`, `blogs/`, `inbox/`, `raw/`.
- **Schema:** a **318-line `CLAUDE.md`**. His framing: *"The 'product' is a markdown document that tells the LLM how to behave."*
- **Page format:** "compiled truth" — synthesized current understanding on top (rewritten on update), append-only evidence timeline below a divider.
- **Routing:** a **MECE resolver decision tree** over eight categories (tasks, URLs, learnings, people, projects, concepts, observations). This is the closest thing in Part A to accretion's routing — but it always routes; there is no abstention branch.
- **Tooling:** six slash-command skills — `/remember`, `/recall`, `/todo`, `/brain`, `/ingest`, `/brief`. Storage is markdown in GitHub, synced via git, viewed in Obsidian. **Search is plain LLM grep over index files and summaries** — no embeddings, no CLI, no MCP.
- **Numbers:** bootstrap from one messy note produced **37 tasks, 14 bookmarks, 8 learnings, 16 people pages, 12 projects, 2 concepts** in one session. He estimates the design holds to ~**400,000 words** before needing a database.
- **What he rejected:** autonomous "dreaming"/auto-capture, which *"creates slop… The system generates pages you never asked for."* On passive capture: *"Nobody has solved passive capture well yet… without human intent, the system does not know what matters."* He also dropped databases, APIs, and integrations.
- **Honest gap:** no operational failure modes reported, because there was no elapsed time.

---

### A.3 Casey Newton (Platformer) — the actual one-month report

Published **2026-08-18**, wiki created ~one month earlier. This is the closest thing to the retrospective you were looking for.
https://www.platformer.news/karpathy-llm-wiki-journalism-productivity/

- **Structure/tooling:** Markdown in Obsidian; seeded with his entire Platformer archive back to 2020, which Claude split into individual files. Daily ingest via Obsidian Web Clipper plus a script that files clips into the wiki. Queried through the Claudian plugin. Prompt generated by Claude, run from Ghostty.
- **Numbers:** **1,440+ wiki pages**. His Meta page alone is **12,000+ words with 1,300+ links**. Six years of archive ingested.
- **What broke:** *"The wiki needs more or less constant maintenance."* Pages grow unwieldy; the ingest scripts break and need fixing; he switched the rewriting model from Claude to GPT to hold AP style.
- **Payoff cited:** timeline context on the OpenAI/Hugging Face breach story "saved me tons of time."

### A.4 Joi Ito — "What I Learned from Karpathy's LLM Wiki — and What We Already Do Better"

April 2026 gist, written from several months of running a pre-existing system (Jibrain/jibot).
https://gist.github.com/Joi/120f86eb39758ef75deb5e6145e5a717

- **Scale:** **5,700+ vault files** with entity resolution.
- **Tooling:** **qmd** hybrid BM25+vector with dual indexes; **Senzing** for entity linking; MCP integration; a "Curator Mind" agent; a **seven-gate audit system**; tiered access control (owner / assistant / trusted / general); intake→atlas→domains three-tier lifecycle; description-first protocol.
- **Failure mode reported:** *"at 4000+ notes, index files break"* — this figure appears in comment analysis rather than the body, so treat as **[weakly sourced]**.
- **Diagnosis:** *"the maintenance operations deserve as much design attention as the ingestion pipeline"* — specifically calls out missing contradiction detection and provenance tracking. This is the sharpest statement in Part A that governance, not ingest, is the hard part.

### A.5 Eugeniu Ghelbur (The AI Operator) — six months in production

Published **2026-04-29**.
https://theaioperator.io/p/i-rebuilt-karpathys-llm-wiki-heres

- **Five additions to Karpathy:** (1) in-place rewriting rather than append-only, with stale claims dated below current facts; (2) automatic contradiction resolution reconciling by recency and authority; (3) unsolicited synthesis of unnamed recurring themes; (4) **scheduled agents** running nightly and weekly; (5) an "AI-First Vault Principle" — frontmatter, "For future Claude" preambles, recency markers, i.e. notes optimized for LLM retrieval over human reading.
- **Shipping form:** **31 slash commands** + **4 scheduled agents**, plain markdown with YAML frontmatter, model-agnostic vault.
- **What broke:** during `/research-deep` testing — wrong model assignment produced academic prose instead of structured markdown; reasoning tags leaked into output; stringified dicts produced malformed frontmatter.
- **The lesson worth stealing:** *"The right level of automation is not 'everything always,' it is 'everything reversibly.'"* All scheduled agents now log to daily diffs with a 24-hour reversibility window.
- **Numbers:** research commands cost **$0.04–$0.80 per call**; no page/token counts.

### A.6 Fabio Akita (AkitaOnRails) — the endorse-then-retract arc

Published **2026-05-18**, with a **2026-05-23 walk-back**.
https://akitaonrails.com/en/2026/05/18/ai-agent-memory-karpathy-llm-wiki-agentmemory/ · pt-BR: https://akitaonrails.github.io/2026/05/18/memoria-agentes-karpathy-llm-wiki-agentmemory/

- **His manual baseline:** `./.docs/` or `./docs/` organized by topic (architecture, decisions, gotchas, configurations), with a root `MEMORY.md`/`CLAUDE.md` index. His honest complaint: *"I have to remember to ask. The agent won't do it on its own."* — the exact gap a passive recall hook fills.
- **He then adopted agentmemory** (Rohit Ghumare, Apache-2.0): node daemon on `:3111` REST and `:3113` viewer, SQLite + vector index, **MCP server with 51 memory tools**, **12 Claude Code hook plugins and 6 Codex hooks**, BM25 + vector + KG fusion via RRF, tiers working → episodic → semantic → procedural.
- **What broke within five days:** BM25 reindexed on every restart; a **5-second data-loss window**; the hook fired on the **wrong key for ~47% of Claude Code tool calls**; accumulating bugs requiring rewrites. He withdrew the recommendation and rebuilt in Rust as `ai-memory`.
- **Claimed-but-unvalidated numbers he passes through:** agentmemory's "R@5 95.2% retrieval, 92% fewer tokens" — he explicitly does not validate them. **[unverified]**
- His research doc adds the operating detail: **one source ingest fans out to 10–15 wiki pages**; `index.md` holds as retrieval anchor to ~**100 sources**; `log.md` uses a `## [YYYY-MM-DD]` prefix convention specifically so Unix tools can parse it. MCP ops named `memory_ingest` / `memory_query` / `memory_lint` / `memory_consolidate`, with query as a hierarchy: index → candidate pages → full read → hybrid-search fallback.
https://github.com/akitaonrails/ai-memory/blob/main/docs/research-karpathy-llm-wiki.md

### A.7 Rohit Ghumare — "LLM Wiki v2"

https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2

- Extends the pattern with confidence scoring, supersession tracking, **Ebbinghaus-curve retention decay**, tiered consolidation, a typed knowledge graph (entities + typed relations `uses` / `caused` / `contradicts`), hybrid BM25+vector+graph with RRF, and event-driven hooks (auto-ingest, session-start context injection, session-end compression, scheduled lint/consolidate).
- **States a scaling threshold:** a single `index.md` **breaks around 200–500 documents**.
- **The comments are the valuable part** — five failure modes: numeric confidence scores give false precision without evidence chains; auto-crystallization corrupts silently when the LLM invents dependencies; forgetting curves destroy useful history (explicit git-style supersession works better); **cross-entity inference pollution** (retrieving Company A's facts contaminates reasoning about Company B); and there is no epistemic layer separating facts from hypotheses.
- Only number: "95.2% on LongMemEval-S" for three-way hybrid retrieval. **[unverified]**

### A.8 Taktile engineering — the only rigorous production evaluation I found

Published **2026-07-13** (corporate byline, no individual author).
https://engineering.taktile.com/blog/llm-wiki-agent-memory/

- **Structure:** markdown on a dedicated repo branch, nested category sub-wikis, **`index.md` at every level** summarizing what's below, reviewed like code.
- **Retrieval:** SQLite FTS5 + BM25 primary, vector for semantics, LLM judgment for selection, fused with RRF.
- **Ingest:** a "Query + Ingest" loop that **re-validates every wiki fact against its linked source** on read, checks for new information, and distills claims back. A **weekly lint job catches contradictions and stale claims after the fact.**
- **Numbers (the best in Part A):** 24 test queries against 88 wiki entries. LLM judgment = **69.1 s** latency, best accuracy; BM25 = **0.47 ms**, pragmatic accuracy. Production: **$2.50 / 9m40s with validation vs $0.98 / 1m19s without** — i.e. skipping validation is **86% faster and 61% cheaper**, which is precisely the pressure that makes wikis rot.
- **Unsolved, stated:** shared sources (Notion, GDrive, web) "constantly change underneath us" with no update signal.

### A.9 Packaged implementations worth knowing

| Project | Person | Shape | Notable |
|---|---|---|---|
| `Astro-Han/karpathy-llm-wiki` | Astro-Han | Agent Skill (`npx add-skill`), works in Claude Code/Cursor/Codex | `raw/` + `wiki/` + `index.md` + append-only `log.md`; ingest/query/lint; lint checks broken links, missing index entries, stale cross-refs. **94 articles across 13 topic dirs, 99 sources, 87 log entries in last 7 days**, daily since April 2026. Explicitly **no CLI, no MCP** — https://github.com/Astro-Han/karpathy-llm-wiki |
| `lucasastorian/llmwiki` | Lucas Astorian | Full product: MCP + web app + Chrome extension | `wiki/` (markdown) + `.llmwiki/` (SQLite search index + artifacts, rebuildable). MCP tools: guide, search, read, create, edit, append, delete, **lint**. Lint validates citations, detects orphaned/stale pages, checks frontmatter. **1.6k stars, 229 forks, 185 commits** — https://github.com/lucasastorian/llmwiki |
| `llm-wiki-plugin` | Praney Behl | Claude Code plugin + agentskills.io skill | Markdown canonical; local SQLite vector index with FastEmbed; optional typed graph layer **with provenance**; hybrid semantic+BM25 at section granularity with **JSON evidence output**; init/ingest/query/lint. No published numbers — https://praneybehl.github.io/llm-wiki-plugin/ |
| `mwe-mcp` | Fr4nZ82 | MCP "Memory Wiki Engine" | `wikis/` markdown prose + `engine.db` SQLite holding **per-fact governance metadata**; **per-fragment ACL** (sentence-level visibility), subject-vs-sender separation, validity windows and closure (never deletion), **per-reader redaction before the agent sees the page**. Nightly "REM cycle" dedups, merges near-synonym pages, closes open facts, re-anchors dates, recompiles facts into prose. Tools: `wiki_ingest_message` (per-turn), `wiki_search`, `wiki_navigate`, `wiki_read`, `wiki_forget`. Tested on a multi-week multi-user replay corpus + one live household — https://github.com/Fr4nZ82/mwe-mcp |
| Angie Jones | Angie Jones | Conference program-chair agent, 2026-06-22 | Canonical three-layer with `index.md`, `log.md`, `AGENTS.md` as schema; folders for events/sessions/speakers/sources/trends/topics. Scale "thousands" of sessions/speakers. **No tooling specified, no failure modes reported** — https://angiejones.tech/karpathys-llm-wiki-as-agent-memory/ |
| Wuphf | (via The Agentic Digest) | Git-backed wiki | `~/.wuphf/wiki/`, **Bleve BM25 + SQLite, deliberately no vector or graph DB** — "local, auditable text files, standard Git tooling, and a classical search index you can debug" — https://www.theagenticdigest.com/issues/git-llm-agent-wiki |

Institutional framing: Harrison Chase's LangChain post (2026-06-30) defines wiki memory as *"an agent-maintained data structure that represents source knowledge in an agent-friendly way,"* files chosen because they are "inspectable, editable, versionable." It cites DeepWiki (Cognition) and AutoWiki (Factory) as the codebase analogues. **No benchmarks, no ingest/lint spec** — the pattern has no standard.
https://www.langchain.com/blog/wiki-memory

Nate's critique frames the real fork as **write-time vs query-time thinking**, and warns *"a neglected wiki is more dangerous than a neglected database."* Paywalled; only the preview is verifiable. **[unverified beyond preview]**
https://natesnewsletter.substack.com/p/your-ai-re-derives-everything-it

---

## Part B — Memory architectures a practitioner should know

### B.1 MemGPT / Letta — OS-style paging (arXiv 2310.08560)
**Idea:** Treat the context window like RAM and external storage like disk; the LLM itself issues function calls to page data between a fast "main context" and slow archival/recall storage, driven by OS-style interrupts. Packer, Wooders, Lin, Fang, Patil, Stoica, Gonzalez.
**Measured:** Deep Memory Retrieval (multi-session chat recall) and nested key-value retrieval / document QA.
**Headline:** **93.4% on DMR with GPT-4 Turbo vs a 35.3% baseline**; on nested KV retrieval GPT-4 hits **0% at three levels of nesting** while MemGPT sustains performance via iterative archival lookups.
**Limitation:** the biggest one is epistemic — *the agent's retrieval is only as good as its own queries; if it does not know what it does not know, it never issues the lookup and degrades silently back to fixed-context behavior.* Also: MSC is narrow persona-chat data, and archival scaling to millions of docs is untested.
https://arxiv.org/abs/2310.08560 · https://ar5iv.labs.arxiv.org/html/2310.08560

### B.2 A-MEM — Zettelkasten agentic memory (arXiv 2502.12110, NeurIPS 2025)
**Idea:** Each memory becomes an atomic "note" with LLM-generated contextual description, keywords and tags; the system then autonomously links new notes to semantically related historical ones. **Memory evolution:** adding a new note can retroactively rewrite the context and attributes of old notes. Xu, Liang, Mei, Gao, Tan, Zhang.
**Measured:** LoCoMo, split single-hop / multi-hop / temporal / open-domain, across six foundation models.
**Headline:** up to **6× ROUGE-L improvement on multi-hop** with non-GPT models; more than doubles GPT-4o-mini multi-hop; **85–93% reduction in memory-operation token usage**.
**Limitation:** results ride on LoCoMo, whose validity is now contested (B.8); retroactive rewriting of historical notes is exactly the "silent corruption" failure the Part A practitioners hit; no provenance or reversibility story.
https://arxiv.org/abs/2502.12110 · https://github.com/agiresearch/a-mem

### B.3 Mem0 and Mem0^g (arXiv 2504.19413)
**Idea:** A two-phase pipeline that extracts salient facts from a conversation, then consolidates them against existing memory (add/update/delete) rather than appending. The graph variant `Mem0^g` represents the same content as entities and typed relations. Chhikara, Khant, Aryan, Singh, Yadav.
**Measured:** LoCoMo against six baseline categories, plus p50/p95 search and end-to-end latency.
**Headline:** **26% relative improvement in LLM-as-a-Judge over OpenAI memory**; **91% lower p95 latency** and **>90% token cost savings** vs full-context; graph variant only **~2%** above base. Search latency p50 0.148s / p95 0.200s; total median 0.708s.
**Limitation:** the graph adds ~2% for meaningful complexity — weak justification. More seriously, Zep alleges the comparison itself is broken (B.8).
https://arxiv.org/abs/2504.19413

### B.4 Zep / Graphiti — temporal knowledge graph (arXiv 2501.13956)
**Idea:** Graphiti is a temporally-aware KG engine that ingests both unstructured conversation and structured business data, and updates **non-lossily** — facts and relations carry explicit validity intervals, so superseded facts are invalidated rather than deleted. Rasmussen, Paliychuk, Beauvais, Ryan, Chalef.
**Measured:** DMR (MemGPT's own benchmark) and LongMemEval.
**Headline:** **DMR 94.8% vs MemGPT's 93.4%**; LongMemEval accuracy **up to +18.5%** with **~90% latency reduction**, strongest on cross-session synthesis.
**Limitation:** the DMR margin (1.4 points) is thin, and Zep's own later post concedes DMR/LoCoMo conversations are far too short to test long-term memory. Ingest is LLM-heavy and therefore expensive per turn.
https://arxiv.org/abs/2501.13956

### B.5 Generative Agents — reflection (Park et al., 2023)
**Idea:** A **memory stream** of every observation in natural language, retrieved by a weighted score over **recency (exponential decay) × importance (self-assessed integer) × relevance (embedding similarity)**; periodically the agent synthesizes high-level **reflections** from retrieved memories and writes them back as new memories, forming a tree.
**Measured:** believability of agent behavior, via human evaluation with component ablations.
**Headline:** ablations show observation, planning and **reflection each contribute critically** — removing reflection materially degrades believability.
**Limitation:** believability is not accuracy; the scoring weights are hand-tuned; no notion of contradiction, provenance, or forgetting. It is the origin of "importance scoring," which the Part A comments independently identify as false precision.
https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763

### B.6 Sleep-time compute (arXiv 2504.13171, Letta + UC Berkeley)
**Idea:** Split a query into "context" and "question"; spend compute offline on the context before the question arrives, pre-computing inferences and rewriting the memory state. Lin, Snell, Wang, Packer, Wooders, Stoica, Gonzalez.
**Measured:** Stateful GSM-Symbolic and Stateful AIME (restructured so context precedes query), plus Multi-Query GSM-Symbolic.
**Headline:** **~5× less test-time compute** for the same accuracy; **up to +13%** on Stateful GSM-Symbolic and **+18%** on Stateful AIME by scaling sleep-time compute; **2.5× lower average cost per query** when amortized across related queries on one context.
**Limitation:** stated explicitly — efficacy correlates with **query predictability**. If you cannot anticipate the question, precomputation is wasted. This is the theoretical justification for nightly lint/consolidation jobs, and also the reason they sometimes burn tokens for nothing.
https://arxiv.org/abs/2504.13171 · https://www.letta.com/blog/sleep-time-compute/

### B.7 2026 consolidation / forgetting
- **SleepGate — "Learning to Forget"** (Ying Xie, 2026-03-15). Conflict-aware temporal tagger + learned forgetting gate + consolidation module, triggered by adaptive entropy over the KV cache during "sleep micro-cycles." **99.5% retrieval accuracy at proactive-interference depth 5, 97.0% at depth 10, vs all five baselines below 18%**; reduces interference horizon **O(n) → O(log n)**. **Limitation: a 4-layer, 793K-parameter toy transformer** — do not generalize this to frontier models. https://arxiv.org/abs/2603.14517
- **SCM: Sleep-Consolidated Memory with Algorithmic Forgetting** — perfect recall over ten-turn conversations, **90.9% memory-noise reduction** via adaptive forgetting. Short horizon; **[numbers from search snippet, abstract not fetched]**. https://arxiv.org/abs/2604.20943
- **FSFM** — biologically-inspired selective forgetting. https://arxiv.org/pdf/2604.20300
- **Survey framing:** forgetting and consolidation are best understood as *stability operators containing harmful plasticity*; the recurring design is **decay in accessibility, not destructive deletion**, with decay rates keyed to relevance, access frequency and temporal pattern.

### B.8 Evaluating memory — and the case against the benchmarks

**LoCoMo** (Maharana et al. 2024) — the field's default. Ten categories including abstention and contradiction resolution.
**LongMemEval** (Wu, Wang, Yu, Zhang, Chang, Yu; Oct 2024) — **500 curated questions** over freely scalable chat histories, testing **five abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention**. Headline: commercial assistants and long-context LLMs show a **30% accuracy drop** on sustained-interaction recall. Note that **abstention is a first-class measured ability here** — relevant to Part C below. Critique: synthetic conversations with limited topical diversity. https://arxiv.org/abs/2410.10813
**MemBench** (Tan, Zhang, Ma, Chen, Dai, Dong; ACL 2025 Findings) — evaluates **effectiveness, efficiency and capacity**, crossing factual vs reflective memory levels with participation vs observation scenarios. Motivated by prior benchmarks' narrow memory levels and single-metric evaluation. https://aclanthology.org/2025.findings-acl.989/ · https://arxiv.org/abs/2506.21605

**The critiques, which matter more than the scores:**

1. **Penfield Labs' LoCoMo audit** (2026-04): **6.4% of the answer key is wrong** — 99 score-corrupting errors in 1,540 questions (hallucinated facts in the key, bad temporal reasoning, speaker misattribution). The **gpt-4o-mini judge accepted 62.81% of intentionally wrong answers** (catching specific factual errors ~89% of the time but passing vague topic-correct answers ~67%). **Theoretical ceiling for a perfect system: ~93.6%.** Per-category n often <100, so **56% of per-category comparisons are statistically indistinguishable from noise.** And devastatingly: **simple filesystem operations scored 74% on LoCoMo**, matching or beating sophisticated memory systems. https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg
2. **Zep vs Mem0** (Chalef & Rasmussen, May 2025, corrected through June 2026): a correct Zep implementation scores **75.14% ±0.17 J** vs Mem0 Graph's ~**68%** — and, critically, the **full-context baseline scores ~73%, beating Mem0's best**, meaning the benchmark barely rewards having memory at all. LoCoMo conversations are only **16,000–26,000 tokens**. Alleged errors in Mem0's Zep harness: wrong user model assignment, timestamps bypassing Zep's native fields, sequential instead of parallel search. https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
3. **Passive recall ≠ agentic use.** The 2026 survey reports models scoring **near-perfectly on LoCoMo plummet to 40–60% on MemoryArena** — success at passive recall does not transfer to decision-relevant memory use. Same survey: *"nobody evaluates forgetting well."* Taxonomy is three-dimensional (temporal scope × representational substrate × control policy); open problems named as hoarding-vs-amnesia in consolidation, learned selective-forgetting policies, and deletion/compliance for parametric memory. https://arxiv.org/html/2603.07670v1
4. **Vendor numbers, for calibration** (Mem0 Engineering Team, published 2026-04-01, updated through Sept 2026): Mem0 **92.5 on LoCoMo** (~6,956 tok/query vs ~26,000 full-context) and **94.4 on LongMemEval** (~6,787 tok/query); Zep 80.32 LoCoMo / 71.2 LongMemEval; Letta 74.0; OpenAI Memory 52.9. On BEAM, **64.1 at 1M tokens falling to 48.6 at 10M** — a 25% drop showing scale is unsolved. Their own honest caveat: *"92.5 on LoCoMo does not tell you how the system performs on your healthcare or legal workload."* Self-reported, so **[vendor-sourced]**. https://mem0.ai/blog/state-of-ai-agent-memory-2026
5. **Emerging negative-case evaluation.** A precision-aware benchmark (Jeffrey Flynt, arXiv 2605.11325) introduces **`mustExclude` and `shouldOnlyInclude` assertions**, making retrieval noise visible at the retrieval layer instead of downstream — noting that returning the whole store scores recall 1.0 while failing precision. Related metrics now appearing: **Memory Integrity** (coverage of required memory points) and **False Memory Rate** (fabricated memories introduced during storage/update/use). PDF was not text-extractable, so specifics are **[unverified beyond metadata + search snippets]**. https://arxiv.org/pdf/2605.11325
6. **When *not* to write.** "When Not to Write Memory: Governing False Promotion from Correlated Agent Traces" (Qi, Xu, Li) targets **false promotion** — elevating coincidentally-correlated trace observations into persistent memory — and proposes a decision framework with cluster-noise AUPRC and actionable-recall metrics. **[abstract-level only; PDF poorly extractable]** https://arxiv.org/pdf/2607.02579

---

## Patterns that keep recurring across A and B

- **Compile at write time, not query time.** Karpathy's gist, LangChain's framing, Nate's "write-time vs query-time" fork, and sleep-time compute's 5× result are the same claim at four levels of formality. The cost is that write-time work is speculative — sleep-time compute's own limitation (efficacy tracks query predictability) is the honest bound on the whole pattern.
- **`index.md` is a load-bearing component that fails at a knowable scale, and nobody agrees where.** Rohit Ghumare says 200–500 docs; Akita says ~100 sources; Joi Ito's comments say 4,000+ notes; Taktile sidesteps it with `index.md` at every level; Hadi Javeed estimates ~400k words. Everyone hits it; the threshold depends entirely on whether the index is a router or a summary.
- **The retrieval stack has converged and is boring.** BM25 (usually SQLite FTS5) + local embeddings + Reciprocal Rank Fusion + optional cross-encoder rerank. qmd, Taktile, agentmemory, llm-wiki-plugin, Wuphf, LLM Wiki v2 and Mem0's stack are the same recipe. **RRF is the single most reused component across both halves of this report.**
- **Rewriting beats appending, and everyone rediscovers it separately.** Hadi Javeed's "compiled truth" header + append-only timeline, Ghelbur's in-place rewrite with dated stale claims, Zep's validity intervals, A-MEM's memory evolution, and Karpathy's own note that append-only bases "get stale invisibly." The universal caveat: rewriting without provenance is indistinguishable from corruption.
- **Maintenance, not ingest, is where these systems die.** Casey Newton ("constant maintenance"), Joi Ito ("maintenance operations deserve as much design attention as the ingestion pipeline"), Taktile (weekly lint catches contradictions *after the fact*), Akita's 5-day collapse. Part B's answer to the same problem is consolidation/forgetting research — and its own survey admits "nobody evaluates forgetting well."
- **Validation is the first thing cut under cost pressure.** Taktile's numbers make this concrete and generalizable: dropping source re-validation is **86% faster and 61% cheaper**. Every wiki that rots, rots along that gradient.
- **Confidence scores and importance scores are consistently reported as false precision.** Park et al.'s self-assessed importance integer, LLM Wiki v2's numeric confidence, and agentmemory's tiers all draw the same critique: a number without an evidence chain is worse than no number, because it launders uncertainty into apparent authority.
- **Benchmark numbers in this space should be treated as marketing until audited.** A 6.4% corrupt answer key, a judge that accepts 63% of wrong answers, a full-context baseline beating the winner, and plain filesystem grep at 74% — all on the benchmark that A-MEM, Mem0 and half the field report as their headline.
- **Fan-out is the hidden cost of the wiki pattern.** One ingest touches 10–15 pages (Akita, and the gist itself). That is the tax the graph systems (Zep, Mem0^g) pay for at query time instead — and it is why unscoped "update the wiki" commands are the most-warned-against operation in Part A.

---

## What none of them do — and what several of them actually do

I looked specifically for each of accretion's five features. Two are genuinely rare; three have prior art you should know about and cite.

**1. Markdown-native governance — partially claimed elsewhere.**
`mwe-mcp` (Fr4nZ82) is the closest and you should read it: markdown prose in `wikis/` with **per-fragment ACL at sentence granularity**, subject-vs-sender separation, validity windows with closure rather than deletion, and **per-reader redaction applied before any agent sees the page**. But its governance metadata lives in `engine.db` (SQLite), not in the markdown — the markdown is the rendered artifact, not the governed object. Joi Ito's system has tiered access control (owner/assistant/trusted/general) and a seven-gate audit, again layered over a vault rather than expressed in it. **If accretion expresses governance rules *in* markdown such that the rules are diffable and reviewable in the same PR as the content, I found no other system doing that.** https://github.com/Fr4nZ82/mwe-mcp · https://gist.github.com/Joi/120f86eb39758ef75deb5e6145e5a717

**2. Routing with abstention — the routing half exists, the abstention half does not.**
Hadi Javeed's MECE resolver decision tree over eight categories is real routing, but it has no "none of these / do not file" branch — by construction it always classifies. On the retrieval side, **abstention is a measured ability in LongMemEval and a LoCoMo category**, and "Do Agents Know What They Can't Do?" (arXiv 2605.28532) studies feasibility awareness for tools. But I found **no memory system that routes a query and declines to recall.** The survey finding that LoCoMo-perfect models drop to 40–60% on MemoryArena is indirect evidence of why this matters. **This looks genuinely novel as a system feature, though not as an evaluation concept.** https://arxiv.org/abs/2410.10813 · https://arxiv.org/pdf/2605.28532

**3. Propose-only edits — this exists elsewhere, and you should say so.**
**Panella** is a self-hosted governed-memory MCP server whose whole design is propose-only: **default-deny writes** (an agent's MCP write "can only ever propose"), two-factor approval separating the agent's routing bearer from an operator-held approval token, and **chain-verified approval receipts** — "never a silent background rewrite." Apache-2.0. Separately, **memorywire** (Munirathinam, arXiv 2606.01138) standardizes a **"Co-memorize diff-and-approve"** pattern at the *wire-format* layer: the system computes a structured diff between proposed write and current state, shows it to a human, and commits only on approval, with a governance JSON schema and reference UI that any backend adapter inherits. **Accretion's differentiator here cannot be "propose-only"; it has to be that the diff is a markdown diff in git rather than a JSON governance message.** https://glama.ai/mcp/servers/panellatech/panella · https://arxiv.org/pdf/2606.01138

**4. Passive recall hook — well-established prior art.**
Alexandre El Khoury's SuperBrain (2026-05-29) is the cleanest statement of the problem: **"Storage is solved; what's missing is automatic, context-aware injection at the right moment,"** diagnosed from **8,785 observations across 13 projects** in claude-mem that never surfaced unless explicitly asked for. His architecture: five non-blocking capture hooks (`PostToolUse`, `UserPromptSubmit`, `PreCompact`, `SessionEnd`, `Stop`) plus a **`SessionStart` recall hook** injecting project-scoped context, with routing into six scopes (`projects/`, `decisions/`, `lessons/`, `captures/`, `daily/`, `meta/`) and daily/weekly/monthly rollups. MemSearch injects a `[memsearch]` hint on `UserPromptSubmit`; claude-mem uses lifecycle hooks; mann1x/claude-hooks does deterministic recall with HyDE and attention decay. Akita's complaint — *"I have to remember to ask. The agent won't do it on its own"* — is the demand side. **Note the counter-argument you'll have to answer: Hadi Javeed deliberately rejected passive capture as "slop," and Yuanjian Liu's comparison flags per-turn summarization latency/cost as the recurring failure.** https://alexandrekhoury.com/writing/superbrain-session-memory-claude-code · https://www.yuanjianliu.net/posts/claude-code-memory-system-compared/ · https://github.com/mann1x/claude-hooks

**5. Negative-case evals — exists in the benchmark literature, absent from every practitioner system.**
The concept is live in 2026 research: **`mustExclude` / `shouldOnlyInclude` assertions** (arXiv 2605.11325), **False Memory Rate** and **Memory Integrity** metrics, and "When Not to Write Memory" on false promotion (arXiv 2607.02579). But **not one of the ~12 Part A implementations runs any eval at all, let alone negative cases.** Taktile is the sole exception with any evaluation (24 queries × 88 entries) and it measures latency/accuracy/cost, not false recall. **This is accretion's strongest genuine gap-fill: importing a research-grade practice into the practitioner tier where it is entirely missing.**

**The honest summary:** none of accretion's five features is unprecedented in isolation — propose-only and passive recall have direct prior art, and markdown governance has a near-neighbor. What I did not find anywhere is **the combination**: a markdown-native, git-diffable system that routes with an abstention branch, gates writes as proposals, recalls passively, and holds itself to negative-case evals. Every Part A system picks one or two; the Part B systems that do governance well (Panella, memorywire, mwe-mcp) abandon markdown as the governed substrate. The strongest claim you can defend is composition, plus being the only one in the file-based camp that evaluates itself at all.

---

**Sources:**
[Karpathy llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) · [tobi/qmd](https://github.com/tobi/qmd) · [obsidian-qmd](https://github.com/achekulaev/obsidian-qmd) · [lazyqmd](https://alexanderzeitler.com/articles/introducing-lazyqmd-a-tui-for-qmd/) · [Hadi Javeed](https://hadijaveed.me/2026/04/15/i-tried-karpathys-llm-knowledge-base/) · [Hadi Javeed sitemap](https://hadijaveed.me/sitemap.xml) · [Hadi Javeed archive 2026](https://hadijaveed.me/archive/2026/) · [Casey Newton / Platformer](https://www.platformer.news/karpathy-llm-wiki-journalism-productivity/) · [Joi Ito gist](https://gist.github.com/Joi/120f86eb39758ef75deb5e6145e5a717) · [Eugeniu Ghelbur](https://theaioperator.io/p/i-rebuilt-karpathys-llm-wiki-heres) · [Fabio Akita](https://akitaonrails.com/en/2026/05/18/ai-agent-memory-karpathy-llm-wiki-agentmemory/) · [akitaonrails/ai-memory research doc](https://github.com/akitaonrails/ai-memory/blob/main/docs/research-karpathy-llm-wiki.md) · [Rohit Ghumare LLM Wiki v2](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2) · [Taktile engineering](https://engineering.taktile.com/blog/llm-wiki-agent-memory/) · [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki) · [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) · [Praney Behl llm-wiki-plugin](https://praneybehl.github.io/llm-wiki-plugin/) · [Fr4nZ82/mwe-mcp](https://github.com/Fr4nZ82/mwe-mcp) · [Angie Jones](https://angiejones.tech/karpathys-llm-wiki-as-agent-memory/) · [The Agentic Digest / Wuphf](https://www.theagenticdigest.com/issues/git-llm-agent-wiki) · [LangChain Wiki Memory](https://www.langchain.com/blog/wiki-memory) · [Nate's Newsletter](https://natesnewsletter.substack.com/p/your-ai-re-derives-everything-it) · [MemGPT](https://arxiv.org/abs/2310.08560) · [A-MEM](https://arxiv.org/abs/2502.12110) · [Mem0](https://arxiv.org/abs/2504.19413) · [Zep/Graphiti](https://arxiv.org/abs/2501.13956) · [Generative Agents](https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763) · [Sleep-time Compute](https://arxiv.org/abs/2504.13171) · [SleepGate](https://arxiv.org/abs/2603.14517) · [SCM](https://arxiv.org/abs/2604.20943) · [LongMemEval](https://arxiv.org/abs/2410.10813) · [MemBench](https://aclanthology.org/2025.findings-acl.989/) · [Penfield Labs LoCoMo audit](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg) · [Zep vs Mem0](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) · [Memory for Autonomous LLM Agents survey](https://arxiv.org/html/2603.07670v1) · [Always-On Agents survey](https://arxiv.org/pdf/2606.30306) · [memorywire](https://arxiv.org/pdf/2606.01138) · [When Not to Write Memory](https://arxiv.org/pdf/2607.02579) · [Precision-Aware Benchmark](https://arxiv.org/pdf/2605.11325) · [Mem0 State of Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) · [Alexandre El Khoury SuperBrain](https://alexandrekhoury.com/writing/superbrain-session-memory-claude-code) · [Yuanjian Liu comparison](https://www.yuanjianliu.net/posts/claude-code-memory-system-compared/) · [Panella](https://glama.ai/mcp/servers/panellatech/panella) · [mann1x/claude-hooks](https://github.com/mann1x/claude-hooks)
