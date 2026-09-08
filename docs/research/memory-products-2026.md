Question: how are the main open-source and commercial agent memory systems (Mem0, Zep/Graphiti, Letta, LangMem, A-MEM, Cognee, Supermemory, Memori) set up, and what do the benchmarks they cite actually measure? Date: 2026-09-08.
Method: primary sources (official docs, GitHub READMEs and source, papers, engineering blogs) gathered by a read-only research agent; vendor claims are marked as such, unverifiable items are marked [unverified].

# Agent Memory Systems, 2026 — Architecture Survey

Scope note: vendor blogs are marked as such. Anything I could not confirm on a primary page is marked **[unverified]**. Benchmark numbers are quoted with the party that produced them, because in this field almost every number is self-reported.

---

## 1. Mem0 (+ OpenMemory MCP)

**Storage model.** Extracted natural-language facts, not raw transcripts. Each memory is a short sentence ("Prefers vegetarian food") in a vector store; the graph variant `Mem0g` stores entity nodes and relationship triplets. The paper's reference stack is a dense-embedding vector DB plus Neo4j for the graph variant ([arXiv:2504.19413](https://arxiv.org/html/2504.19413v1)). The OSS README lists `add / search / get_all / update / delete / history` as the API, with `gpt-5-mini` and `text-embedding-3-small` as current defaults, and three deployment modes: library, self-hosted server, cloud platform ([github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)). Human-readable and human-editable — memories are sentences, and the hosted/self-hosted dashboard exposes them.

**Write path.** Two phases in v2: *extraction* (an LLM sees the last `m=10` messages plus a rolling conversation summary and emits candidate facts) then *update* (retrieve top `s=10` similar existing memories, and an LLM function-call chooses `ADD` / `UPDATE` / `DELETE` / `NOOP`) ([arXiv:2504.19413](https://arxiv.org/html/2504.19413v1)). `Mem0g` does two-stage extraction — entities, then relations — and "marks outdated relationships as invalid rather than deleting them."

The **v3 algorithm (2026) is a significant break**: single-pass extraction (one LLM call instead of extract+merge), and it is **ADD-only** — "nothing is overwritten or deleted"; facts accumulate with temporal context. Graph memory became built-in (no external Neo4j). Agent-generated statements are now treated equally with user statements, where v2 "often ignored" them ([docs.mem0.ai/migration/platform-v2-to-v3](https://docs.mem0.ai/migration/platform-v2-to-v3)). This is a notable philosophical reversal: conflict resolution moved from write-time to read-time ranking.

**Read path.** Explicit `search()` call by the developer/agent; v2 used pure vector similarity, v3 uses "hybrid retrieval combining multiple signals" — semantic, keyword, entity, and temporal — fused into one score, with query entities matched against the user's graph to boost ranking ([same](https://docs.mem0.ai/migration/platform-v2-to-v3)). Token footprint in the paper: ~7k tokens/conversation for Mem0, ~14k for Mem0g, versus a claimed ">600k tokens" for Zep's graph — a figure Zep disputes.

**Consolidation/decay.** v2 had UPDATE/DELETE as its dedup mechanism; v3 removed it in favour of accumulate-and-rank. Mem0's own 2026 report concedes "memory staleness in high-relevance facts remains a harder, open problem" ([mem0.ai/blog/state-of-ai-agent-memory-2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026), vendor).

**Integration surface.** Python/TS SDK, REST, self-hosted server, and **OpenMemory MCP** — a fully local stack (Docker + FastAPI + Postgres for metadata/ACL/audit + Qdrant for vectors) exposing four MCP tools: `add_memories`, `search_memory`, `list_memories`, `delete_all_memories`, with a dashboard where you can inspect, archive, pause, or delete individual memories and see per-app access logs ([mem0.ai/blog/openmemory-mcp](https://mem0.ai/blog/how-to-make-your-clients-more-context-aware-with-openmemory-mcp), vendor). Notably for you, **Mem0 ships a Claude Code plugin built on hooks**: `SessionStart` triggers recall before Claude's first response and "injects up to five relevant" memories; activity capture hooks store user prompts, Claude's answers, changed files and test/build results locally with *no model calls during capture*; `PostToolUseFailure` captures failed commands and their fixes; `SubagentStart/Stop` excludes sidekick output. Memories are split into a shared project bucket keyed by `agent_id` and a personal bucket keyed by `user_id` ([docs.mem0.ai/integrations/claude-code](https://docs.mem0.ai/integrations/claude-code)).

**Evaluation.** Paper (2025): LOCOMO overall J-score **66.88 ± 0.15** (Mem0), **68.44 ± 0.17** (Mem0g), versus full-context 72.90; Zep best on open-domain at 76.60; Mem0g best on temporal at 58.13. Latency p50 0.708s total vs full-context 9.870s ([arXiv:2504.19413](https://arxiv.org/html/2504.19413v1)). 2026 v3 claims: LoCoMo **71.4 → 91.6**, LongMemEval **67.8 → 93.4**, extraction latency ~2.0s → ~1.0s p50 ([migration doc](https://docs.mem0.ai/migration/platform-v2-to-v3)); README states LoCoMo 92.5, LongMemEval 94.4, BEAM-1M 64.1, BEAM-10M 48.6. **Criticism:** Zep published a direct rebuttal alleging Mem0 misconfigured Zep (both speakers assigned the `user` role, timestamps appended to message text instead of the `created_at` field, sequential rather than parallel searches "artificially inflating Zep's reported search latency"), and reports a corrected Zep LoCoMo J-score of **75.14% ± 0.17** vs Mem0's ~68% ([blog.getzep.com](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)). Independent parties note the 92.5 excludes the abstention category entirely (see §8).

**Borrow for accretion:** the Claude Code hook shape is almost exactly your passive recall hook — `SessionStart` recall with a hard cap of five injected items, zero-LLM capture at write time, and the `agent_id`/`user_id` split maps cleanly onto project-vault vs personal-vault routing. Also worth stealing: OpenMemory's per-memory *pause/archive* state, which is a softer curation verb than delete.

---

## 2. Zep / Graphiti

**Storage model.** A temporally-aware knowledge graph in three subgraphs: **episode subgraph** (raw messages/text/JSON stored verbatim), **semantic entity subgraph** (entities + relationship edges carrying a natural-language "fact"), and **community subgraph** (clusters with summaries) ([arXiv:2501.13956](https://arxiv.org/html/2501.13956v1)). Graphiti OSS backs onto Neo4j 5.26+, FalkorDB 1.1.2+, Amazon Neptune (+ OpenSearch for full-text), and Kuzu 0.11.2 (**deprecated**, being removed); Apache 2.0 ([github.com/getzep/graphiti](https://github.com/getzep/graphiti)). Entity and edge types are user-defined Pydantic models — "prescribed ontology" or "learned ontology." Human-readable in the sense that facts are sentences on edges; editable via API/graph tooling rather than a text file.

**Write path.** On ingest (`thread.add_messages` for chat, `graph.add` for business data/JSON/text), an LLM extracts entities and edges. **Bi-temporal model:** four timestamps per edge — `t_valid`/`t_invalid` (when the fact was true in the world) and `t'_created`/`t'_expired` (when the system learned/retracted it). Conflict handling: "the system employs an LLM to compare new edges against semantically related existing edges to identify potential contradictions"; on detection "it invalidates the affected edges by setting their `t_invalid` to the `t_valid` of the invalidating edge" — **superseded facts are invalidated, never deleted** ([arXiv:2501.13956](https://arxiv.org/html/2501.13956v1)). This is the cleanest published temporal-validity model in the space.

**Read path.** Automatic assembly, not agent-chosen, by default. `thread.get_user_context()` runs semantic + BM25 + graph search using "the four most recent thread messages" as the query and returns a **Context Block** — a pre-formatted string containing up to five context types: user summary, facts (with `valid_at`/`invalid_at` annotations, e.g. "User account is suspended due to payment failure (2024-11-14 - present)"), entities, episodes, and thread summaries ([blog.getzep.com/zep-context-types](https://blog.getzep.com/zep-context-types/), [help.getzep.com/retrieving-context](https://help.getzep.com/retrieving-context)). "Smart Context Assembly" picks which types are relevant. Reranking: RRF, MMR, node-distance, or cross-encoder. Claimed **<200ms p95** for context block assembly. Two operationally interesting guidelines from their docs: **keep the context block out of the system message** ("they contain untrusted data" — prompt-injection hygiene), place it as a user message after history to preserve the cacheable prefix; and always supplement with "the last four to six messages" because graph ingestion lags by a few minutes.

**Consolidation/decay.** Community subgraph summarisation; invalidation rather than deletion; `%{user_summary}` regenerated from the whole user graph. No explicit forgetting/TTL documented.

**Integration surface.** Cloud API + Python/TS SDKs; Graphiti OSS as a library; FastAPI REST service in `server/`; **MCP server** in `mcp_server/`; context templates with `%{user_summary}`, `%{edges}`, `%{entities}` variables.

**Evaluation.** DMR: Zep 94.8% (gpt-4-turbo) / 98.2% (gpt-4o-mini) vs MemGPT 93.4%. LongMemEval-S: Zep **63.8%** with gpt-4o-mini (vs full-context 55.4%) and **71.2%** with gpt-4o (vs 60.2%), with latency 2.58s vs 28.9s and context cut from 115k → 1.6k tokens ([arXiv:2501.13956](https://arxiv.org/html/2501.13956v1)). **Criticism:** Zep first claimed ~84% on LoCoMo, revised to 75.14%; Mem0 engineers re-ran it and got **58.44%** ([getzep/zep-papers issue #5](https://github.com/getzep/zep-papers/issues/5)). Mem0's leaderboard lists Zep as "94.7% claimed vs 75.1% in third-party testing" ([mem0.ai/blog/ai-memory-benchmarks-in-2026](https://mem0.ai/blog/ai-memory-benchmarks-in-2026), vendor). Mem0's paper also reports Zep needing >600k tokens/conversation and that "immediate post-ingestion retrieval often failed — correct answers only appeared hours later after background graph processing completed" **[disputed / Zep's rebuttal does not address the token figure]**. DMR itself is largely discredited as too easy (baselines already at 94–98%).

**Borrow for accretion:** the `valid_at`/`invalid_at` annotation *rendered inline into the injected text* is the single most transferable idea — your markdown notes could carry a front-matter validity range and render as "X (valid 2026-01 → 2026-06, superseded)". Also: never delete, mark superseded; and their "context block goes in a user message, not the system prompt, because it's untrusted" rule is a real security argument for how a passive recall hook should inject.

---

## 3. Letta (formerly MemGPT) — including Letta Code / MemFS

**Storage model.** Three tiers: **core memory** = memory blocks pinned into the system prompt; **recall memory** = full message history in the DB, retrievable via API even after compaction/eviction; **archival memory** = a semantically searchable store queried by tool call ([docs.letta.com/guides/agents/memory](https://docs.letta.com/guides/agents/memory), [.../archival-memory](https://docs.letta.com/guides/agents/archival-memory)). A **memory block** has a label, a string value, a size limit, and an optional description; context is "compiled from existing DB state" via customisable Jinja templating ([letta.com/blog/memory-blocks](https://www.letta.com/blog/memory-blocks/)). Blocks are shareable across agents by `block_id` and editable by humans via the API and the ADE.

The 2026 development is **MemFS**: "a git repository containing the agent's persistent state," projected as a real file checkout the agent edits with ordinary file tools. Files are **Markdown with YAML frontmatter**. Path semantics carry meaning: `system/` files "load into the system prompt every turn" (persona, preferences, project facts, workflow rules); everything outside `system/` stays out of context, with only the directory tree visible in the system prompt as signposts. Layout is `$MEMORY_DIR/{system,reference,skills}/`. "Every memory edit is committed to the MemFS git repository." Notably: **MemFS has no built-in semantic index** — keyword/hybrid search is an optional "MemFS Search" mod ([docs.letta.com/concepts/memfs](https://docs.letta.com/concepts/memfs)).

**Write path.** Agent-driven tool calls (`core_memory_append`/`replace`, `rethink_memory`, `archival_memory_insert` with tags). Archival memory is deliberately agent-*immutable* — the agent can insert but not easily edit/delete; developers can via SDK. Plus **sleep-time compute**: a second "sleep-time agent" holds the memory-editing tools for the primary agent, which itself lacks them; it runs asynchronously so memory work doesn't block responses, producing "learned context" from raw context ([letta.com/blog/sleep-time-compute](https://www.letta.com/blog/sleep-time-compute/)). Triggers are configurable — "after a set number of completed agent steps" or "when the context window is compacted" — and there's an optional **"Agent reviews before applying"** setting where the primary agent "review[s] and revise[s] proposed memory updates in a second background conversation" ([docs.letta.com/guides/agents/sleep-time-agents](https://docs.letta.com/guides/agents/sleep-time-agents)).

**Read path.** Hybrid by construction: core blocks / `system/` files are injected every turn with a hard character budget per block; archival and reference material require an explicit tool call. No ranking budget beyond block size limits and search `top_k`.

**Consolidation/decay.** Sleep-time agent rewrites blocks wholesale rather than appending, "generat[ing] cleaner, more organized memories compared to traditional incremental memory approaches." Message compaction/eviction with full history retained in the DB.

**Integration surface.** Letta server (self-hosted or cloud), REST + Python/TS SDKs, ADE (visual agent/memory editor), and **Letta Code** — a coding-agent harness with git-tracked memory, hooks ("run custom scripts at key points of agent execution"), `/memory-repository set git@github.com:...` to sync to your own repo, `/palace` to view memory, `/doctor` to "audit memory quality," `/sleeptime` to configure dreaming ([github.com/letta-ai/letta-code](https://github.com/letta-ai/letta-code)).

**Evaluation.** MemGPT reported 93.4% on DMR (the benchmark Zep then beat). Mem0's 2026 leaderboard puts Letta at 74.0 LoCoMo ([mem0.ai](https://mem0.ai/blog/state-of-ai-agent-memory-2026), vendor); Mem0's benchmark round-up explicitly says Letta "lack[s] published citable scores." Sleep-time compute cites AIME and GSM-Symbolic gains, not memory benchmarks ([letta.com](https://www.letta.com/blog/sleep-time-compute/)).

**Borrow for accretion:** Letta Code is the closest cousin to what you're building, and it validates three of your choices — markdown-with-frontmatter vault, git as the audit trail, and path-as-routing (`system/` = always loaded, everything else = recall-on-demand). The two things to steal outright: (a) **propose-then-review** — their sleep-time agent proposes memory edits and the primary agent reviews in a separate conversation, which is exactly propose-only curation with a named execution model; (b) `/doctor`, a memory-quality audit command, which is a cheap surrogate for task-level eval.

---

## 4. LangChain LangMem

**Storage model.** Storage-agnostic by design. Memories are JSON documents in a LangGraph `BaseStore` (`InMemoryStore` for dev, `AsyncPostgresStore` for prod) with optional vector indexing (`dims`, `embed: openai:text-embedding-3-small`), organised by hierarchical **namespaces** ([github.com/langchain-ai/langmem](https://github.com/langchain-ai/langmem)). Two shapes for semantic memory: **collections** (unbounded, searched at runtime) and **profiles** (a single document with a strict schema) ([conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)). Three memory types: semantic (facts), episodic (successful past interactions with their reasoning and context), procedural (system prompts as refinable behavioural rules).

**Write path.** Two modes, explicitly contrasted. **Hot path / "conscious formation"**: the agent calls `create_manage_memory_tool(namespace=("memories",))` mid-conversation — "immediate updates when critical context emerges" but it "adds perceptible latency to user interactions." **Background / "subconscious formation"**: `create_memory_store_manager` runs after the interaction or during idle time, "finding patterns and extracting insights without slowing down the immediate interaction." The Memory Manager does three things: extract new memories, update/remove outdated ones, and "consolidate and generalize from existing memories" — e.g. identifying a fact about Bob that is no longer true and overwriting or deleting it. Managers are "functions that transform memory state without side effects."

**Read path.** Purely tool-chosen by default (`create_search_memory_tool`), plus whatever you inject yourself; profiles are typically injected wholesale into the prompt. No built-in reranker or token budget documented.

**Consolidation/decay.** Handled by the same Memory Manager consolidation pass. **Prompt optimizers** are the distinctive piece: they rewrite the agent's own system prompt from conversation traces plus optional human feedback — procedural memory as a first-class updatable artefact.

**Integration surface.** Python SDK only in practice; LangGraph-native. **Status caveat:** the repo was active as of June 2026 and is not archived, but the latest PyPI release is 0.0.30 from 27 Oct 2025 — no new release in ~7 months — and third parties describe it as "newer, less battle-tested" than LangGraph checkpointers or Zep **[secondary source: search summary of db0.ai and repo state; treat version details as unverified]**.

**Evaluation.** LangMem publishes no memory benchmark of its own. It appears as a *baseline* in Mem0's paper, best-in-class on LOCOMO multi-hop at 47.92 ([arXiv:2504.19413](https://arxiv.org/html/2504.19413v1)).

**Borrow for accretion:** the hot-path/background split with an explicit latency argument is the cleanest framing of why curation should be deferred and propose-only. And **prompt optimizers** suggest a second artefact class for your vault: not just facts but refinable routing/behaviour rules, updated from observed failures.

---

## 5. A-MEM (agiresearch, NeurIPS 2025)

**Storage model.** Zettelkasten-style atomic notes. Each note = original content, timestamp, LLM-generated keywords, tags, a contextual description, an embedding, and **links to other memories** ([arXiv:2502.12110](https://arxiv.org/html/2502.12110v1)). Embeddings via `all-MiniLM-L6-v2`. Storage backend is not named in the paper (ChromaDB in the repo **[unverified]**, [github.com/agiresearch/A-mem](https://github.com/agiresearch/a-mem)).

**Write path.** Three steps on every add: **note construction** (LLM generates the structured attributes), **link generation** (retrieve top-k similar notes by embedding, then an LLM decides which connections are meaningful), and **memory evolution** (the new note "trigger[s] updates to existing related memories' contextual representations, keywords, and tags"). There is no ADD/UPDATE/DELETE decision engine — old notes are refined, not replaced.

**Read path.** Cosine similarity over embeddings, configurable top-k, links traversable from retrieved notes.

**Consolidation/decay.** Memory evolution is the consolidation mechanism; no forgetting/TTL.

**Integration surface.** Research code, Python. No MCP/hosted offering.

**Evaluation.** LoCoMo (7,512 QA pairs, gpt-4o-mini): multi-hop F1 **45.85%** vs MemGPT 25.52%; open-domain 44.65% vs LoCoMo baseline 40.36%; average F1 27.02% vs MemGPT 26.65%. Token cost "around 1,200–2,500 tokens versus 16,900 tokens" for LoCoMo/MemGPT ([arXiv:2502.12110](https://arxiv.org/html/2502.12110v1)). In Mem0's independent re-run, A-Mem scored 49.91 on the temporal category — well below Mem0g's 58.13.

**Borrow for accretion:** A-MEM is essentially "a markdown vault with backlinks, built by an LLM." The transferable bit is **retrieval-triggered refinement**: when a new note is written, use the top-k neighbours not just to dedup but to propose edits to *their* tags and context lines — which fits propose-only curation, since each proposal is a small diff to an existing file.

---

## 6. Cognee

**Storage model.** Unified graph + vector + relational. The **ECL pipeline** (Extract → Cognify → Load) replaces ETL's "Transform" with "Cognify": parse any format, extract entities and relations, ground them in an auto-generated ontology (with RDF/OWL URI alignment and cross-document coreference resolution), store as a queryable knowledge graph ([docs.cognee.ai](https://docs.cognee.ai/), [cognee.ai/blog/grounding-ai-memory](https://www.cognee.ai/blog/deep-dives/grounding-ai-memory)). Graph backends: Kuzu, Neo4j, NetworkX; vector: LanceDB, Qdrant, pgvector. "Graph.cognee 1.0 runs the full agent memory layer — graph, vectors, sessions, and metadata — on a single Postgres instance" **[vendor claim]**. Structured as typed `DataPoints`; inspectable via their graph UI.

**Write path.** Explicit `add()` then `cognify()` (or `remember`/`improve` in the newer framing) — batch/pipeline, not per-turn. Ontology validation is the conflict-control mechanism rather than an LLM add/update/delete arbiter. Temporal invalidation is not a headline feature the way it is for Zep.

**Read path.** Explicit `search()` with typed modes: `GRAPH_COMPLETION`, `RAG_COMPLETION`, `INSIGHTS`, `CHUNKS` (and `GRAPH_COMPLETION_COT` in their benchmarks).

**Consolidation/decay.** `memify` / pipeline re-runs; ontology alignment does the deduplication work. No documented decay.

**Integration surface.** Python SDK, MCP server, hosted platform. $7.5M seed led by Pebblebed, Feb 2026; ~17.7k GitHub stars **[vendor/secondary]**.

**Evaluation.** Their own harness on a **24-question HotPotQA subset**, 45 runs each: Cognee (GRAPH_COMPLETION_COT, tuned) human-like correctness **0.93**, DeepEval correctness 0.85, F1 0.84; Graphiti 0.88 / 0.74 / 0.70; LightRAG 0.96 / 0.67 / **0.09**; Mem0 0.72 / 0.54 / 0.12 ([cognee.ai/blog/knowledge-graph-memory-benchmarks](https://www.cognee.ai/blog/deep-dives/knowledge-graph-memory-benchmarks)). To their credit they state the caveats themselves: "This is cognee's benchmark, not an independent study. We built the harness and we published the numbers"; competitors ran on published defaults with no tuning sweeps; and LightRAG's 0.96 human-likeness against F1 0.09 shows "LLMs prefer fluent, verbose answers." A 24-question sample is not a benchmark — treat all four numbers as directional at best.

**Borrow for accretion:** the ontology-first idea maps to *typed notes* — if every note in the vault declares a type (decision, preference, gotcha, person), routing and abstention both get easier, because "no note of the right type exists" is a cheap abstain signal. Also: their willingness to publish the "our own harness" caveat is the standard your task-level eval should meet.

---

## 7. Supermemory

**Storage model.** A persistent memory graph plus documents. "Extracts facts from conversations, handles temporal changes, contradictions, and automatic forgetting" ([github.com/supermemoryai/supermemory](https://github.com/supermemoryai/supermemory)). Scoping via `containerTag` (project / workspace / user), so work vs personal vs per-repo memory are separate scopes.

**Write path.** Ingest via `/v3/documents`; automatic extraction; explicit claims of contradiction handling and automatic forgetting, but the mechanism is not published **[unverified]**.

**Read path.** `/v3/search` with three modes — hybrid (default), memories-only, document-only. Plus **Infinite Chat**, an intelligent proxy that transparently extends context: you point your OpenAI/Anthropic client at their proxy and it swaps long history for retrieved memory ([supermemory.ai/docs/model-enhancement/context-extender](https://supermemory.ai/docs/model-enhancement/context-extender)). That is the most aggressive "automatic injection" design in this survey — the app doesn't even know it's happening.

**Consolidation/decay.** "Automatic forgetting" is claimed; no published algorithm **[unverified]**.

**Integration surface.** REST, npm/PyPI SDKs, Vercel AI SDK / LangChain / LangGraph integrations, hosted **MCP server at `https://mcp.supermemory.ai/mcp`** for Claude Desktop and Cursor, and a **single-binary local mode** (`supermemory local`) with an embedded graph engine and local embeddings (`Xenova/bge-base-en-v1.5` default, Ollama for fully offline).

**Evaluation.** Claims "#1 on every major AI memory benchmark — LongMemEval, LoCoMo, and ConvoMem," with "95% Recall@15" and "99.4% context reduction" ([github README](https://github.com/supermemoryai/supermemory), vendor). Mem0's leaderboard, by contrast, lists Supermemory among systems that "lack published citable scores" ([mem0.ai](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)) — so the #1 claim is **unverified** against any third-party run I could find.

**Borrow for accretion:** `containerTag` is a clean model for brief routing — the scope is a first-class parameter on both write and read, so "which vault" is decided by an explicit tag rather than inferred each time. And search *modes* (memories-only vs documents-only vs hybrid) is a useful abstention lever: a brief router can ask for memories-only and get a legitimately empty result.

---

## 8. Memori (GibsonAI)

**Storage model.** SQL-native, deliberately anti-vector-DB: extracted facts and preferences in standard PostgreSQL / MySQL / SQLite tables, framed as "application data that must be queryable, portable, and auditable" ([MarkTechPost](https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/), [github.com/GibsonAI/Memori](https://github.com/GibsonAI/Memori)). Maximum human readability — you can `SELECT` your agent's memory. Memories are tracked at three levels: **entity** (user/agent), **process** (specific agent program), **session**.

**Write path.** "Universal recording" — `memori.enable()` intercepts LLM calls across OpenAI, Anthropic, LiteLLM and LangChain, so "no changes to your agent code or prompts are required." Conversations are "persisted and recalled automatically in the background." Extraction produces typed augmentations: attributes, events, facts, people, preferences, relationships, rules, skills. Three named agents — Memory Agent, Conscious Agent, Retrieval Agent — and a dual-mode design combining "'conscious' working memory with 'auto' intelligent search" **[modes documented only at this level of detail in the sources I could reach; the docs site 404'd on two paths]**.

**Read path.** Automatic injection into the LLM call via the same interception layer; SQL/full-text retrieval rather than embeddings.

**Consolidation/decay.** Not documented in the sources reachable **[unverified]**.

**Integration surface.** Python/TS SDK, MCP, OpenClaw plugin, BYODB deployment (cloud / VPC / on-prem).

**Evaluation.** No memory-benchmark numbers published. Claims **80–90% cheaper than vector-DB solutions** and 10–50ms response times ([MarkTechPost](https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/), vendor-sourced).

**Borrow for accretion:** the entity/process/session triple is a better scoping model than a flat user_id, and it maps onto vault/agent/conversation. The stronger lesson is the positioning: *auditability as the product*. Your markdown vault has the same pitch, with git as the audit log instead of SQL.

---

## 9. Baseline worth naming: Anthropic's memory tool + the "markdown reversion"

Anthropic's memory tool (beta, `memory_20250818`, header `context-management-2025-06-27`, launched 29 Sep 2025) is a **client-side** tool: Claude issues create/view/`str_replace`/insert/delete/rename calls against a `/memories` directory and *your application* executes them, so you fully control storage. Claude "automatically checks a `/memories` directory at the start of a task." Paired with context editing, Anthropic reports **84% token savings** on long-running tasks ([docs.claude.com/.../memory-tool](https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)). This is the strongest primary-source endorsement of the file-based approach: no embeddings, no extraction LLM, plain files.

There is a loud 2026 narrative that "top agents are reverting to Markdown" (OpenClaw's `memory/YYYY-MM-DD.md` + `MEMORY.md`, Manus's `todo.md`, Claude Code's `CLAUDE.md`), with a claimed crossover near ~50,000 stored items below which BM25 + a simple index beats a vector setup on latency and operability. **Treat this as unverified advocacy** — the most-cited article ([epsilla.com](https://www.epsilla.com/blogs/markdown-memory-death-of-vector-databases-agentic-memory)) "cites no external research, academic papers, or third-party validation" and references only its own products. Its criticisms of markdown memory are the useful half and worth taking seriously for accretion: concurrent writers causing constant git merge conflicts, the filesystem not being an access-control model, degradation when searching millions of files, and `git log` not being a compliance-grade audit trail.

---

## 10. The benchmarks

### LoCoMo
Very long multi-session dialogue — up to 35 sessions of ~9,000 tokens — with QA, event summarisation, and timeline ordering; 1,540 questions in the standard harness across 5 categories, over only **10 conversations** in the public release ([mem0.ai/blog/ai-memory-benchmarks-in-2026](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)).

Known problems, in order of severity:

1. **The answer key is wrong 6.4% of the time.** An audit of all 1,540 questions found **99 score-corrupting errors** — hallucinated facts in the answer key, incorrect temporal reasoning, and 24 speaker-attribution errors — establishing "a theoretical maximum score of approximately 93.6% for a perfect system, making small performance differences uninterpretable" ([Penfield Labs audit](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg)).
2. **The LLM judge accepts 62.81% of intentionally wrong answers.** Specific factual errors (wrong name/date) were caught ~89% of the time, but "vague answers that identified the correct topic while missing every specific detail passed nearly two-thirds of the time."
3. **Abstention is structurally excluded.** The standard harness sets `CATEGORIES_TO_EVALUATE = [1, 2, 3, 4]`, dropping all **446 adversarial questions (22.5%)** where refusal is the correct answer; and the answer prompt instructs "NEVER say 'not specified'… COMMIT AND ANSWER." One practitioner reports their abstention-focused system scored **0.000** discrimination across all 446 adversarial cases — identical to a system with no abstention mechanism at all — and a 0.603 false-abstain rate when refusal mechanisms were combined ([dev.to/gde03](https://dev.to/gde03/the-ai-memory-benchmark-everyone-quotes-forbids-saying-i-dont-know-o1n)).
4. **It fits in context.** Zep's own critique: conversations average "16,000–26,000 tokens," "easily within the context window capabilities of modern LLMs," and the benchmark "doesn't test knowledge updates"; they also flag "Category 5 was unusable due to missing ground truth answers" ([blog.getzep.com](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)).
5. **Numbers aren't comparable across labs.** Mem0's own round-up concedes: "two labs running 'the same benchmark' with different choices on [judge model, answering model, reranking] will not land on the same number," and lists conflicting self-reports (ByteRover 92.2% *or* 96.1%; Zep 94.7% claimed vs 75.1% third-party).
6. **LoCoMo-Plus doesn't fix it** — it "inherits all 1,540 original LoCoMo questions unchanged, including the 99 score-corrupting errors," and its improved judging was validated only on the new cognitive questions.

### LongMemEval
500 curated questions over scalable chat histories, measuring five abilities: **information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention**; the paper reports a ~30% accuracy drop for commercial assistants on sustained interactions ([arXiv:2410.10813](https://arxiv.org/abs/2410.10813)). LongMemEval-S is ~115K tokens / ~40 sessions; -M is ~500 sessions.

Critiques: (a) at ~115K tokens per question against 200K–1M-token models, "the entire test corpus fits in a single context window, making it a context window test, not a memory test" ([Penfield Labs](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg)); (b) severe statistical underpowering — the Preferences category has 30 questions (≈±18% at 95% confidence) and some multi-session subgroups have as few as 6 (≈±40%); (c) filler conversations are sourced from *other* benchmarks rather than generated in-framework, so evidence-bearing and filler sessions are distributionally distinguishable **[these three points come from a secondary summary of the audit; (a) is directly quoted from the audit, (b) and (c) I could not confirm verbatim on a primary page — treat as likely but unverified]**.

### 2025–2026 successors
- **BEAM** — "Beyond a Million Tokens," ICLR 2026: 100 conversations, 2,000 validated questions, spanning 100K → **10M tokens**, testing ten abilities: preference following, instruction following, information extraction, knowledge update, multi-session reasoning, summarisation, temporal reasoning, event ordering, **abstention**, and contradiction resolution ([arXiv:2510.27246](https://arxiv.org/pdf/2510.27246), [github.com/mohammadtavakoli78/BEAM](https://github.com/mohammadtavakoli78/BEAM)). Its LIGHT framework reports 3.5–12.7% over the strongest long-context baselines, with the gap widening at scale. Mem0 reports 64.1 (BEAM-1M) → 48.6 (BEAM-10M) — a **~25% relative drop for 10× context**, which is the most honest number in this entire report about where the field actually is.
- **LongMemEval-V2** (UCLA, arXiv:2605.12493, May 2026): shifts from chat to **web-agent trajectories** at 25M–115M tokens, multimodal, 451 manually curated questions, testing static state recall, dynamic state tracking, workflow knowledge, environment gotchas, and premise awareness. Best baseline AgentRunbook-C: **72.5%** on the small tier vs RAG methods at 57.8% ([arXiv:2605.12493](https://arxiv.org/html/2605.12493v1)).
- **ConvoMem** (arXiv:2511.10523) — argues "your first 150 conversations don't need RAG," i.e. the whole memory-system premise doesn't pay off until a threshold **[title-level only; not fetched]**.

### What this means for you
No published number in this report should be treated as evidence that system A beats system B. Every headline was produced by the vendor whose system won. The only defensible position is the one Cognee stated about its own results and the one Mem0 stated about cross-lab comparability. If accretion is doing **task-level eval**, that is not a compromise — it is currently the more rigorous choice, because the general benchmarks have a 6.4% corrupt answer key, a judge that accepts 63% of wrong answers, and a standard harness that deletes the abstention category.

---

## 11. Cross-cutting summary for accretion

| System | Store | Write trigger | Conflict handling | Read path | Human-editable |
|---|---|---|---|---|---|
| Mem0 v3 | vectors + built-in entity graph | every turn (async) | **ADD-only**, resolve at rank time | explicit search; hybrid 4-signal | yes (sentences + dashboard) |
| Zep/Graphiti | temporal KG (Neo4j/FalkorDB/Neptune) | on ingest | bi-temporal invalidation, never delete | **auto** Context Block, <200ms p95 | via API, not a text file |
| Letta | blocks in prompt + archival + **MemFS git/markdown** | agent tool calls + sleep-time agent | rewrite-whole-block; propose-then-review | `system/` always-on + tool-call recall | **yes — markdown + git + ADE** |
| LangMem | LangGraph BaseStore (Postgres) | hot path *or* background | Memory Manager consolidation (update/delete) | tool call | JSON via store |
| A-MEM | notes + embeddings + links | every add | evolve neighbours, no delete | top-k cosine + links | yes (structured notes) |
| Cognee | graph+vector+SQL, ontology-grounded | batch `cognify()` | ontology/coreference alignment | typed `search()` modes | via graph UI |
| Supermemory | memory graph + docs | ingest, auto | "contradictions + automatic forgetting" [unverified] | **auto via proxy**, or /v3/search | partial |
| Memori | plain SQL tables | universal interception | not documented | auto-injected, SQL/FTS | **yes — it's SQL** |

**The four things most worth taking:**

1. **Letta's MemFS is your architecture, already shipped.** `system/` = always loaded, tree-visible-but-unloaded elsewhere, markdown + YAML frontmatter, every edit a git commit, `/doctor` to audit quality. Read that page closely; it is prior art for path-as-routing and it tells you what they found necessary to add (an optional search mod, because a filesystem alone has no index).
2. **Propose-then-review has a working reference implementation** in Letta's "Agent reviews before applying" sleep-time setting — a background agent proposes memory diffs, a second conversation reviews them.
3. **Render temporal validity into the injected text.** Zep's `fact (valid: 2024-01-15 to present)` costs almost nothing in a markdown vault and is what makes abstention on stale facts possible.
4. **Cap and instrument the injection.** Mem0's Claude Code hook injects "up to five" memories on `SessionStart` with zero LLM calls at capture time. That is the right shape for a passive recall hook, and the cap is the budget logic.

**The two warnings:** Mem0 abandoned write-time conflict resolution (ADD/UPDATE/DELETE) in v3 after building a whole paper around it — worth understanding why before you commit to write-time curation decisions. And the honest critique of file-based memory (concurrent-writer merge conflicts, no access-control model, `git log` as an insufficient audit trail) is the part of the markdown-advocacy discourse that isn't marketing.

**Sources:**
1. https://arxiv.org/html/2504.19413v1
2. https://docs.mem0.ai/migration/platform-v2-to-v3
3. https://github.com/mem0ai/mem0
4. https://docs.mem0.ai/integrations/claude-code
5. https://mem0.ai/blog/how-to-make-your-clients-more-context-aware-with-openmemory-mcp
6. https://mem0.ai/blog/state-of-ai-agent-memory-2026
7. https://mem0.ai/blog/ai-memory-benchmarks-in-2026
8. https://arxiv.org/html/2501.13956v1
9. https://github.com/getzep/graphiti
10. https://help.getzep.com/concepts
11. https://help.getzep.com/retrieving-context
12. https://blog.getzep.com/zep-context-types/
13. https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
14. https://github.com/getzep/zep-papers/issues/5
15. https://www.letta.com/blog/memory-blocks/
16. https://www.letta.com/blog/sleep-time-compute/
17. https://docs.letta.com/guides/agents/memory
18. https://docs.letta.com/guides/agents/archival-memory
19. https://docs.letta.com/guides/agents/sleep-time-agents
20. https://docs.letta.com/concepts/memfs
21. https://github.com/letta-ai/letta-code
22. https://github.com/langchain-ai/langmem
23. https://langchain-ai.github.io/langmem/concepts/conceptual_guide/
24. https://arxiv.org/html/2502.12110v1
25. https://github.com/agiresearch/a-mem
26. https://docs.cognee.ai/
27. https://www.cognee.ai/blog/deep-dives/knowledge-graph-memory-benchmarks
28. https://www.cognee.ai/blog/deep-dives/grounding-ai-memory
29. https://github.com/supermemoryai/supermemory
30. https://supermemory.ai/docs/model-enhancement/context-extender
31. https://github.com/GibsonAI/Memori
32. https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/
33. https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool
34. https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg
35. https://dev.to/gde03/the-ai-memory-benchmark-everyone-quotes-forbids-saying-i-dont-know-o1n
36. https://arxiv.org/abs/2410.10813
37. https://arxiv.org/html/2605.12493v1
38. https://arxiv.org/pdf/2510.27246
39. https://github.com/mohammadtavakoli78/BEAM
40. https://www.epsilla.com/blogs/markdown-memory-death-of-vector-databases-agentic-memory
