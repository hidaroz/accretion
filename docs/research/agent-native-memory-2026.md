Question: how do the coding agents and assistants themselves (Claude Code, Codex, ChatGPT, Cursor, Windsurf, Copilot, Gemini CLI) handle memory and context management, and how do experienced practitioners set them up? Date: 2026-09-08.
Method: primary sources (vendor docs, changelogs, engineering blogs, named practitioner posts, upstream GitHub issues) gathered by a read-only research agent; anything not verified against a primary page is marked [UNVERIFIED].

# Memory & Context Management in Coding Agents — 2026 Survey

**Method note:** 27 pages fetched, primary sources only (vendor docs, changelogs, engineering blogs, named practitioner posts, upstream GitHub issues). Claims are cited inline. Anything I could not verify against a primary page is marked **[UNVERIFIED]**.

---

## 1. Claude Code

### 1.1 Two systems, both loaded every session

Claude Code separates *instructions you write* (CLAUDE.md) from *learnings it writes* (auto memory). Both load at the start of every conversation, and both are "context, not enforced configuration" — the docs are explicit that to *block* an action you need a PreToolUse hook instead. ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory))

| | CLAUDE.md | Auto memory |
|---|---|---|
| Who writes | You | Claude |
| Contains | Instructions, rules | Learnings, patterns |
| Scope | Project / user / org | Per git repository, shared across worktrees |
| Loaded | Every session | Every session (first 200 lines or 25 KB of `MEMORY.md`) |

### 1.2 CLAUDE.md hierarchy (load order, broadest → most specific)

1. **Managed policy** — `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS), `/etc/claude-code/CLAUDE.md` (Linux/WSL), `C:\Program Files\ClaudeCode\CLAUDE.md`. Cannot be excluded by individual settings. Can also be inlined via the `claudeMd` key in `managed-settings.json`.
2. **User** — `~/.claude/CLAUDE.md`
3. **Project** — `./CLAUDE.md` or `./.claude/CLAUDE.md`
4. **Local** — `./CLAUDE.local.md` (gitignored)

Files are **concatenated, not overridden**. Across the tree, content is ordered filesystem-root-down, so instructions closest to the launch directory are read last; within a directory, `CLAUDE.local.md` is appended after `CLAUDE.md`. Subdirectory CLAUDE.md files **load lazily** — only when Claude reads a file in that directory. ([memory docs](https://code.claude.com/docs/en/memory))

**Rules directory:** `.claude/rules/*.md` (recursive, symlink-friendly). Rules without `paths:` frontmatter load at launch with the same priority as `.claude/CLAUDE.md`. Rules *with* `paths:` glob frontmatter load only when Claude reads a matching file. User-level rules live in `~/.claude/rules/` and load before project rules. `claudeMdExcludes` (glob patterns against absolute paths, merged across settings layers) lets you skip other teams' files in a monorepo. ([memory docs](https://code.claude.com/docs/en/memory))

### 1.3 @imports

`@path/to/import`, relative to the *importing file*, **max depth 4 hops**. Imports are expanded and loaded at launch — the docs say bluntly that splitting into imports "helps organization but doesn't reduce context." Import parsing skips code spans and fenced blocks, so `` `@README` `` stays literal. An import in a *project* file that resolves outside the working directory triggers a one-time approval dialog; decline once and it stays disabled permanently. User-scope files are trusted without the dialog (except in Cowork desktop sessions). Block-level HTML comments are stripped before injection — free maintainer notes that cost zero tokens. ([memory docs](https://code.claude.com/docs/en/memory))

`AGENTS.md` is **not** read by Claude Code. The documented bridge is `@AGENTS.md` at the top of CLAUDE.md, or a symlink. `/init` also reads `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`, and (with `CLAUDE_CODE_NEW_INIT=1`) `AGENTS.md`, `.devin/rules/`, `.windsurf/rules/`, `.clinerules`. `/import` (v2.1.213+) appends a one-time copy plus MCP servers, commands, subagents, skills. ([memory docs](https://code.claude.com/docs/en/memory))

### 1.4 Auto memory — what it writes, when, where

Four `type:` values in frontmatter: `user` (role, expertise, working preferences), `feedback` (corrections you gave, approaches you confirmed), `project` (ongoing work, deadlines, decisions not derivable from code or git), `reference` (where to find external info). It explicitly **skips anything derivable from the codebase** (architecture, file paths, debugging fixes) and anything CLAUDE.md already says. It does not write every session — it decides based on likely future usefulness. ([memory docs](https://code.claude.com/docs/en/memory))

- **Location:** `~/.claude/projects/<project>/memory/`, `<project>` derived from the git repo so all worktrees share one directory. Overridable with `autoMemoryDirectory` (any settings scope) or `CLAUDE_CODE_PROJECT_DIR_NAME` + `CLAUDE_CONFIG_DIR`.
- **Layout:** a `MEMORY.md` index (one line per memory) plus one topic file per memory. Only the index is loaded at startup; topic files are read on demand with normal file tools.
- **Budget enforcement:** after a write, Claude Code measures `MEMORY.md` against 200 lines / 25 KB. Near the limit it reminds Claude to shorten; over the limit the write succeeds but returns an *error telling Claude to rewrite the index*, because overflow is silently dropped on next load.
- **Freshness:** if a memory file has YAML frontmatter, Claude Code stamps a `modified` ISO-8601 field on every write (v2.1.214+). It never adds frontmatter to a file that lacks it.
- **Retention:** memory files are *excluded* from the `cleanupPeriodDays` transcript sweep.
- **Isolation:** main-conversation auto memory is **not** inherited by subagents (except forks). Subagents get their own memory directory via the `memory` field.
- **Toggle:** `/memory` toggle → `autoMemoryEnabled` in settings, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

Human-editable: yes, plain markdown, machine-local, editable or deletable at any time.

### 1.5 `/memory` and `/context`

`/memory` lists CLAUDE.md / CLAUDE.local.md / other memory locations across user and project scope (including files that don't exist yet — selecting creates them), toggles auto memory, and opens the auto memory folder. `/context` is the ground truth for *what actually loaded* — the docs repeatedly send you there to debug. `InstructionsLoaded` hook logs exactly which instruction files loaded, when, and why (matchers: `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`). ([memory docs](https://code.claude.com/docs/en/memory), [hooks reference](https://code.claude.com/docs/en/hooks))

### 1.6 Compaction — what survives

| Mechanism | After compaction |
|---|---|
| System prompt / output style | Unchanged (not in message history) |
| Project-root CLAUDE.md, unscoped rules | **Re-injected from disk** |
| Auto memory | **Re-injected from disk** |
| Plan written in plan mode | **Re-injected from disk** |
| Rules with `paths:` frontmatter | Reloaded when Claude next reads a matching file |
| Nested CLAUDE.md | Reloaded when Claude next reads a file in that subdir |
| Files read/edited | Up to **five** re-read, most-recently-modified first; >5,000 tokens comes back as a path reference only |
| Invoked skill bodies | Re-injected, **5,000 tokens/skill, 25,000 total**, oldest dropped first, truncation keeps the *start* of the file |
| Hook-added context | Summarized away with the conversation |
| SessionStart hooks matching `compact` | Re-run, output added to compacted context |

([context window docs](https://code.claude.com/docs/en/context-window))

Controls: `/compact <instructions>`, `/autocompact 500k` to set the trigger point, `/rewind` → "Summarize from here / up to here", `/clear` between unrelated tasks, and a `## Compact Instructions` section in CLAUDE.md. Order of operations when filling: Claude Code "clears older tool outputs first, then summarizes the conversation if needed." If a single huge file refills context each pass, it stops after a few attempts with a thrashing error rather than looping. ([how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works))

Independent source-code comparison by Mario Zechner (badlogic), Dec 2025: Claude Code auto-triggers around ~95% capacity; Codex CLI at token thresholds (180k–244k by model); OpenCode on dynamic overflow; Amp deliberately has **no** auto-compaction. His conclusion: multiple compactions cause cumulative quality degradation, and he recommends 85–90% thresholds, visible warnings, and an off switch. ([gist](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f))

### 1.7 `--continue` / `--resume`

Transcripts are JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, 30-day default retention (`cleanupPeriodDays`). A resumed session restores full conversation history including tool calls and results, the model, the `--agent`, permission mode (with a documented per-path table), active goal, and unexpired scheduled tasks. It does **not** restore `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model`, or `--add-dir` directories. `--fork-session` / `/branch` copies the transcript into a new ID. ([sessions docs](https://code.claude.com/docs/en/sessions))

Notable: on Pro/Max, resuming a session >100k tokens after ~1 hour idle offers **"Resume from summary"** vs **"Resume full session as-is"** — an explicit, user-facing recall-vs-cost tradeoff dialog, because the prompt cache has expired either way.

### 1.8 Anthropic's published context-engineering guidance

- **Context rot** is named as the governing constraint: "as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases." Tune compaction prompts by **maximizing recall first, then improving precision**. Tool-result clearing is "the safest, lightest-touch form of compaction." Sub-agents return 1,000–2,000 token summaries. Just-in-time retrieval with lightweight identifiers beats pre-loading; **naming conventions, folder hierarchies, and timestamps are cited as efficient relevance signals** that let an agent judge a file without reading it. ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))
- **Best practices** page: the CLAUDE.md test is *"Would removing this cause Claude to make mistakes? If not, cut it."* Explicit failure mode: "Bloated CLAUDE.md files cause Claude to ignore your actual instructions." Emphasize *one* line with IMPORTANT, not many. `/doctor` proposes cuts for derivable content. Two failed corrections → `/clear` and rewrite the prompt. ([best practices](https://code.claude.com/docs/en/best-practices))

### 1.9 API-side: memory tool + context editing

**Memory tool** (`{"type": "memory_20250818", "name": "memory"}`, all Claude 4+ models, client-side). Commands: `view` (dirs 2 levels deep, files with 6-char right-aligned line numbers), `create`, `str_replace`, `insert`, `delete`, `rename`. `/memories` is a *prefix your handler maps onto real storage*. The API auto-injects this system prompt when the tool is present:

> `IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE.` … `ASSUME INTERRUPTION: Your context window might be reset at any moment, so you risk losing any progress that is not recorded in your memory directory.`

Security is the *implementer's* responsibility: path-traversal validation (`../`, `..\\`, `%2e%2e%2f`), size caps, and **periodic expiry of unaccessed files**. ([memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool))

The same page documents a **multisession software development pattern**: an initializer session sets up a progress log + feature checklist + startup script *before* work begins; each session opens by reading them and closes by updating them; a feature is marked complete only after end-to-end verification, not when code is written. ([memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool); case study: [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents))

**Context editing** — `clear_tool_uses_20250919`: `trigger` (default 100k input tokens), `keep` (default 3 tool-use pairs), `clear_at_least`, `exclude_tools`, `clear_tool_inputs` (default false). Cleared results are replaced with placeholder text so Claude knows something was removed. Clearing **invalidates the cached prompt prefix**, which is why `clear_at_least` exists. Response returns `applied_edits` with `cleared_tool_uses` and `cleared_input_tokens`. ([context editing docs](https://platform.claude.com/docs/en/build-with-claude/context-editing))

Benchmarks: memory + context editing = **+39%** over baseline; context editing alone **+29%**; a 100-turn web search eval saw **84%** token reduction and completed workflows that otherwise failed. Public beta 29 Sep 2025. ([context management announcement](https://claude.com/blog/context-management))

### 1.10 Failure modes reported

- **Auto memory rot at scale.** [anthropics/claude-code#34776](https://github.com/anthropics/claude-code/issues/34776) documents five after 30+ days of daily use: MEMORY.md hits the ~200-line threshold and older entries fall out; corrections accumulate with no expiry and start contradicting each other; preference files become unchallenged load-bearing assumptions; **priority saturation** (everything loads at equal weight, so "always relevant" and "only relevant for X" are indistinguishable); no audit mechanism. Requested: `review_by` / `last_challenged` frontmatter, confidence ratings, a three-layer split (rules vs. topic knowledge), a `/memory-audit` command, and an append-only structural changelog. The core insight: *"memory systems degrade silently — individual sessions feel fine, but accumulated drift over weeks creates gaps."*
- **No clean off switch historically** — [#23544](https://github.com/anthropics/claude-code/issues/23544) / [#23750](https://github.com/anthropics/claude-code/issues/23750) requested disabling auto-memory without disabling CLAUDE.md; now addressed via `autoMemoryEnabled` / `CLAUDE_CODE_DISABLE_AUTO_MEMORY`.
- **Third-party memory plugins silently clobbering native memory** — [claude-mem#2836](https://github.com/thedotmack/claude-mem/issues/2836).
- **"Instructions lost after /compact"** is common enough to have its own docs section; the answer is almost always that the instruction lived only in conversation, or in a nested/path-scoped file that hasn't re-triggered.

> **Accretion could borrow:** the `MEMORY.md`-index-plus-topic-files split (only the index is passive-loaded; bodies are retrieved), the hard budget with a *write-time error that tells the agent to re-curate*, `modified` timestamps as a cheap staleness signal, `paths:`-scoped conditional loading as a routing primitive, and — most directly — issue #34776's wishlist, which is essentially a spec for propose-only curation with expiry and a task-level audit.

---

## 2. OpenAI: Codex CLI and ChatGPT

### 2.1 AGENTS.md

Open format under the Linux Foundation's Agentic AI Foundation; **60,000+** repos. Root file plus optional nested files per package. Precedence: *"The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything."* Supported by 20+ tools including Codex, Jules, Devin, Windsurf, Copilot, VS Code, Cursor, Zed, Aider, Warp, Junie. Plain markdown, no schema. ([agents.md](https://agents.md/))

Codex CLI discovery is tunable: `project_doc_fallback_filenames` (what to try when AGENTS.md is missing) and `project_doc_max_bytes` (byte cap when building project instructions). ([Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference))

### 2.2 Codex memories (opt-in feature)

- **What:** Codex converts useful context from prior chats into local memory files — "summaries, durable entries, recent inputs, and supporting evidence."
- **Where:** `~/.codex/memories/` by default. Explicitly treated as **generated state, not hand-edited files**.
- **When written:** asynchronously in the background, *after a chat has been idle long enough* to avoid summarizing work in progress. Skipped for short-lived sessions and when rate-limit usage is high (`memories.min_rate_limit_remaining_percent`). Secrets are redacted from generated fields.
- **Controls:** `/memories` in both the ChatGPT desktop app and Codex CLI controls per-chat behavior (use existing / contribute to future); global controls in Settings → Personalization. Enable with `[features] memories = true`; knobs include `memories.generate_memories`, `memories.use_memories`, `consolidation_model`, `extract_model`, `max_rollout_age_days` (clamped 0–90).
- **Official positioning:** memories are *"a helpful recall layer, not the only source for rules that must always apply"* — keep required team guidance in AGENTS.md. ([Codex memories](https://learn.chatgpt.com/docs/customization/memories), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference))

### 2.3 Codex compaction

`model_auto_compact_token_limit` sets the trigger; `model_auto_compact_token_limit_scope` chooses whether to count the **full active context** (`total`, default) or only **growth after the carried compaction-window prefix** (`body_after_prefix`). Codex preserves recent user messages (~20k tokens) alongside the summary and prepends a "handoff" prefix explaining the summary came from another LLM. There is also an **experimental** `features.context_management.experimental_mode` that "uses notes and searchable history to preserve accumulated details" *instead of* repeatedly compressing into summaries. ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [badlogic gist](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f))

Session resume: `codex resume`, with search across local chats in the current repo. `/init` generates AGENTS.md; `/status` shows session config. ([Codex CLI docs](https://learn.chatgpt.com/docs/codex/cli))

### 2.4 ChatGPT memory design

Two distinct mechanisms: **saved memories** (a "notepad" stored separately from chat history — deleting a chat does not delete memories derived from it) and **chat history reference** (insights gathered from past chats). ChatGPT saves proactively without being asked when it judges something future-useful, and is trained *not* to proactively store sensitive categories like health details unless asked. Both are independently toggleable; individual memories can be deleted. ([Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq), [Memory and new controls](https://openai.com/index/memory-and-new-controls-for-chatgpt/))

A newer **"Dreaming"** system runs background synthesis across many conversations to build memory without explicit remember-this requests. **[UNVERIFIED — the announcement page returned HTTP 403; details come only from search result summaries.]** ([openai.com/index/chatgpt-memory-dreaming](https://openai.com/index/chatgpt-memory-dreaming/))

### 2.5 Failure modes

Simon Willison's stated worry about ChatGPT-style implicit memory is **cross-chat contamination**: he deliberately starts fresh conversations when debugging to "wipe that rotten context away," and feared automatic memory would drag bad context forward. He was partly reassured that only *user* messages, not assistant responses, are surfaced. His preference is unambiguous — Claude's memory is implemented as **visible tool calls** (`conversation_search`, `recent_chats`), and "I want to understand as much as possible about what's going into my context so I can better anticipate how it is likely to affect the model." ([simonwillison.net/2025/Sep/12/claude-memory/](https://simonwillison.net/2025/Sep/12/claude-memory/))

> **Accretion could borrow:** Codex's *idle-gated, background, propose-only* write path (never summarize work in progress, never write from a short session), secret redaction at generation time, `max_rollout_age_days` as a built-in decay knob, the explicit doctrine "memories are recall, AGENTS.md is law," and the experimental "notes + searchable history instead of re-summarization" direction — which is essentially accretion's thesis.

---

## 3. Cursor, Windsurf/Cascade, GitHub Copilot

### 3.1 Cursor

**Rules** are the durable layer: `.cursor/rules/*.mdc` (markdown + YAML frontmatter, nestable into subdirectories), with four activation types — Always Apply, Apply Intelligently (agent reads the description and decides), Apply to Specific Files (globs), Manual (`@rule-name`). Precedence: **Team Rules → Project Rules → User Rules**. User Rules apply only to Agent Chat, not Inline Edit. `AGENTS.md` is supported as a simpler alternative with nested-directory precedence. Documented guidance: keep rules under 500 lines, reference files rather than copying code, don't duplicate style guides or common tool docs. ([Cursor rules docs](https://cursor.com/docs/context/rules))

**Memories:** "automatically generated rules based on your conversations in Chat," scoped per project at an individual level, enabled from Settings → Rules, shipped as beta in Cursor 1.0. In Cloud Agent **Automations**, memories are named entries (default `MEMORIES.md`) that live *outside* the agent's working filesystem, are on by default, and are viewable/editable from the tool config UI. ([Cursor 1.0 changelog](https://cursor.com/changelog/1-0)) — **[PARTLY UNVERIFIED: `cursor.com/docs/context/memories` now redirects to the Rules overview, so I could not confirm a current approval/review flow or on-disk format from primary docs.]**

**Failure modes** (user forum, no staff reply in thread): memories documented as project-scoped but surfacing globally; project-specific memories (e.g. SQLite settings) leaking into unrelated projects; global memories accumulating clutter from Cursor's automatic suggestions; a `.cursor/learned_memories.mdc` file discovered by users; asymmetric UI (Project Rules exists, Project Memories doesn't); and no way to edit memories as files. ([forum.cursor.com/t/137149](https://forum.cursor.com/t/rules-vs-memories-and-global-vs-project/137149))

### 3.2 Windsurf / Cascade (now Devin Desktop)

Cascade auto-generates memories during conversation when it judges something worth keeping; auto-generated memories are **machine-local only**, cost no flow-action credits, and can be requested on demand. Critically, the docs now note **"Memories apply to the legacy Cascade agent only. The Devin Local agent — the default agent for new tabs — does not persist memories."**

The documented recommendation is to prefer Rules for anything durable, because they are "version-controlled, shareable with your team, and give you explicit control over activation." Three levels: Global (single file, always active, **6,000 char limit**), Workspace (`.devin/rules/` preferred, `.windsurf/rules/` legacy, **12,000 chars each**), System (enterprise, IT-deployed). Workspace rules carry a `trigger` field: `always_on`, `model_decision` (description shown, body fetched on demand), `glob`, `manual` (`@rule-name`). Rules can also be inferred from AGENTS.md. Guidance: bullets and XML tags over long paragraphs. ([docs.devin.ai/desktop/cascade/memories](https://docs.devin.ai/desktop/cascade/memories))

### 3.3 GitHub Copilot

No agent-written memory. Instruction files only: `.github/copilot-instructions.md` (read on every chat/agent request), `.github/instructions/**/*.instructions.md` (YAML frontmatter selects applicable paths), and root `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`, plus personal and organization instructions. `@`-relative-path includes are supported inside instruction files. Support varies by surface (GitHub.com gets all types; Visual Studio only repo-wide and path-specific). The docs do **not** state precedence across file types. ([custom instructions support](https://docs.github.com/en/copilot/reference/custom-instructions-support), [AGENTS.md changelog](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/))

A `/memory` slash command shipped for JetBrains IDEs (Mar 2026) — but it opens *settings for agent instruction files*, not an agent-authored memory store. ([JetBrains changelog](https://github.blog/changelog/2026-03-11-major-agentic-capabilities-improvements-in-github-copilot-for-jetbrains-ides/))

> **Accretion could borrow:** Cascade's four-value `trigger` field is the cleanest published statement of brief routing — especially `model_decision`, where only the *description* enters context and the body is fetched on demand. That is exactly abstention-capable routing with a retrieval fallback. Also note both Cursor and Cascade converge on "auto-memory is a convenience; the version-controlled file is the source of truth" — and Cursor's forum thread is a live case study in what happens when memory scoping is opaque and files aren't editable.

---

## 4. Gemini CLI

`GEMINI.md` context files load hierarchically: `~/.gemini/GEMINI.md` (global), then the CWD and every parent up to the project root (identified by `.git`), then subdirectories. **All found files are concatenated and sent with every prompt.** Filename is configurable via `context.fileName` in `settings.json`. ([gemini-md docs](https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.md))

Commands: `/memory add <text>`, `/memory show` (full concatenated hierarchical memory — a genuinely useful audit surface), `/memory refresh` (reload from disk), `/memory list` (which files are in use). ([CLI commands](https://google-gemini.github.io/gemini-cli/docs/cli/commands.html))

The `save_memory` tool persists "durable facts, user preferences, and project details" by editing markdown, routed across three tiers: repo `GEMINI.md` for shared project instructions, a per-project private memory folder for private notes, and global `~/.gemini/GEMINI.md` for cross-project personal preferences. Guidance: keep durable instructions concise and avoid duplicating the same fact across tiers — but dedup is manual. ([save_memory docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/memory.md))

**Failure modes (upstream issues):** [#10702](https://github.com/google-gemini/gemini-cli/issues/10702) — `/memory refresh` doesn't update the system instruction in an existing chat. [#11488](https://github.com/google-gemini/gemini-cli/issues/11488) — a standing request to refactor hierarchical memory loading from eager concatenation to **dynamic, just-in-time context**, which is the same pressure that produced Claude Code's `paths:` scoping and Cascade's `model_decision` trigger.

> **Accretion could borrow:** `/memory show` as a first-class "here is literally everything that will be in context" command — the cheapest possible eval instrumentation. And the three-tier routing (shared repo / private project / global personal) is a clean vault-partition model.

---

## 5. Practitioner setups worth stealing from

**Harper Reed — [My LLM codegen workflow atm](https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/)** (and [Basic Claude Code](https://harper.blog/2025/05/08/basic-claude-code/)). Three checked-in artifacts as the memory substrate: `spec.md` (produced by interviewing a reasoning model, expandable to a 10,000-word supporting doc), `prompt_plan.md` (a sequence of prompts, each building on the last, no orphaned code), `todo.md` (a checklist the codegen tool ticks off as it goes). The whole point is that these are *repo files*, not agent state — reviewable, diffable, and reusable for non-codegen purposes (critique, white paper, business model).

**Mitchell Hashimoto — [Vibing a Non-Trivial Ghostty Feature](https://mitchellh.com/writing/non-trivial-vibing)** (Oct 2025) publishes every agentic session used to ship one feature; the pattern is building a plan *interactively* with the agent and saving it to `spec.md` for later sessions. [My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey) (Feb 2026) argues the human should control interruption timing, and describes blocking the last 30 minutes of each day to kick off agents. [Prompt Engineering is for Transactional Prompting](https://mitchellh.com/writing/prompt-engineering-transactional-prompting) draws the interactive/transactional distinction that determines how much context engineering is worth doing.

**Simon Willison.** Two contributions. (1) The [memory implementation comparison](https://simonwillison.net/2025/Sep/12/claude-memory/) — visible tool calls over invisible injection, and the cross-chat contamination worry. (2) His relay of **Drew Breunig's failure taxonomy** in [How to Fix Your Context](https://simonwillison.net/2025/Jun/29/how-to-fix-your-context/): *poisoning* (a hallucination enters context and gets repeatedly referenced), *distraction* (long context makes the model over-weight retrieved material vs. training knowledge), *confusion* (irrelevant detail degrades output), *clash* (new info conflicts with what's already there). Six mitigations: RAG, tool loadout (models degrade past ~20 simultaneous tools), quarantine, pruning, summarization, offloading. **Context poisoning is the single most important named risk for an accretion-style system** — a wrong memory that keeps getting recalled is worse than no memory.

**Anthropic engineering (named-team primary sources).** The [long-running harness post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) is the most directly transferable: an initializer agent writes `init.sh`, `claude-progress.txt`, and a JSON feature list with pass/fail; strongly-worded instructions forbid removing tests; each session starts by reading git log + progress file + feature list and **runs a basic end-to-end test before implementing anything new**; one feature at a time; git commits double as recovery points. The reported failure it was designed against: Claude marking features complete without verification.

**Obsidian + agent workflows.** The pattern converging across writeups (Hugo Sequier, [How I Built a Second Brain for Claude Code](https://medium.com/@sequierh/how-i-built-a-second-brain-for-claude-code-b49b3104b386), Apr 2026; Pasquale Pillitteri, [Obsidian + Claude Code](https://pasqualepillitteri.it/en/news/962/obsidian-claude-code-second-brain-persistent-memory), Apr 2026) is a single operating rule: **at session start the agent reads global memory plus the relevant project memory; at session end it writes back what changed** — and the vault is *searched*, not loaded, so notes stay out of RAM until needed. Open-source implementations: [obsidian-second-brain](https://github.com/eugeniughelbur/obsidian-second-brain) (plain markdown in an Obsidian vault, hybrid semantic search, scheduled maintenance agents) and [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian) (retain source → ground claims → connect → reuse). *These are the weakest-authority sources in this report — Medium/personal blog rather than named-practitioner-with-track-record — treat the specific numbers as unverified, but the read-at-start/write-at-end/search-don't-load shape is consistent across all of them.*

**Hooks as the injection mechanism.** The primitives, from the [hooks reference](https://code.claude.com/docs/en/hooks):

| Hook | Fires | Injection |
|---|---|---|
| `SessionStart` | start/resume; matchers `startup`, `resume`, `clear`, `compact`, `fork` | stdout added as context; `additionalContext`, `systemMessage` |
| `UserPromptSubmit` | before each prompt is processed | `additionalContext`, `updatedInput` (rewrites the prompt), `systemMessage`; exit 2 blocks |
| `PreCompact` | before compaction; matchers `manual`/`auto` | `additionalContext`; exit 2 blocks compaction |
| `InstructionsLoaded` | each CLAUDE.md / rule load, incl. lazy | `additionalContext` merged in, `updatedInstructions` replaces file content |
| `SessionEnd` | termination; matchers `clear`, `resume`, `logout`, `prompt_input_exit`, `other` | side effects only; **1.5s shared budget**, raised to 60s max if you set longer timeouts |

The documented pattern for surviving compaction: a `SessionStart` hook matched to the `compact` source, whose output is added to the compacted context. `SessionEnd` receives `transcript_path` and can archive.

> **Accretion could borrow:** the exact hook pair — `SessionStart(startup|resume|compact)` for passive recall and `SessionEnd` for propose-only capture — noting the 1.5s budget makes `SessionEnd` unsuitable for an LLM call, so curation must be enqueued (Codex's idle-gated background worker is the right shape). And Harper Reed's insight that the artifacts should be *repo files a human reviews*, not opaque agent state, is the strongest argument for propose-only.

---

## Cross-cutting synthesis for accretion

| Accretion primitive | Strongest prior art | What to take |
|---|---|---|
| **Markdown vaults** | Claude Code auto memory (`MEMORY.md` index + topic files); Gemini three-tier `save_memory`; Obsidian-agent workflows | Index-loaded / body-retrieved split; three-tier partition (shared repo / private project / global personal); plain markdown so humans can diff and delete |
| **Brief routing with abstention** | Cascade `trigger: model_decision`; Claude Code `paths:` frontmatter; Cursor "Apply Intelligently" | Put only the *description* in context and fetch the body on demand. All three vendors independently landed here; Gemini CLI is being pushed there by [#11488](https://github.com/google-gemini/gemini-cli/issues/11488) |
| **Propose-only curation** | Codex idle-gated background memory generation with redaction; `CLAUDE_CODE_NEW_INIT=1` reviewable proposal before writing; issue #34776's `/memory-audit` + `review_by` wishlist | Never write mid-task; redact at generation; surface a reviewable diff; add expiry metadata and confidence, because #34776 proves un-expired corrections contradict each other within ~30 days |
| **Passive recall hook** | `SessionStart` matched on `startup\|resume\|compact`; the memory tool's auto-injected "ALWAYS VIEW YOUR MEMORY DIRECTORY FIRST / ASSUME INTERRUPTION" prompt | Re-inject on the `compact` matcher specifically — that is the documented seam where hook-added context is otherwise summarized away |
| **Task-level eval** | Anthropic's harness (feature list with pass/fail, verify-before-marking-complete, e2e test *before* new work); `/context` and `/memory show` | Measure recall against a fixed task list, not vibes; instrument "what actually loaded" as a first-class command; +39%/+29%/84% from the [context management post](https://claude.com/blog/context-management) is the published bar |
| **Guardrails** | Breunig's context poisoning; memory-tool path traversal + expiry guidance; #34776 priority saturation | A recalled-and-wrong memory is worse than none — needs a challenge/decay path. Separate "always relevant" from "relevant for X" or everything loads at equal weight |

**Sources:**
[Claude Code memory](https://code.claude.com/docs/en/memory) ·
[Claude Code context window](https://code.claude.com/docs/en/context-window) ·
[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works) ·
[Claude Code best practices](https://code.claude.com/docs/en/best-practices) ·
[Claude Code sessions](https://code.claude.com/docs/en/sessions) ·
[Claude Code hooks reference](https://code.claude.com/docs/en/hooks) ·
[Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) ·
[Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) ·
[Anthropic: Managing context (context management launch)](https://claude.com/blog/context-management) ·
[Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) ·
[Context editing docs](https://platform.claude.com/docs/en/build-with-claude/context-editing) ·
[claude-code#34776 memory governance](https://github.com/anthropics/claude-code/issues/34776) ·
[claude-code#23544](https://github.com/anthropics/claude-code/issues/23544) ·
[claude-mem#2836](https://github.com/thedotmack/claude-mem/issues/2836) ·
[AGENTS.md](https://agents.md/) ·
[Codex memories](https://learn.chatgpt.com/docs/customization/memories) ·
[Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference) ·
[Codex CLI](https://learn.chatgpt.com/docs/codex/cli) ·
[OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) ·
[OpenAI: Memory and new controls](https://openai.com/index/memory-and-new-controls-for-chatgpt/) ·
[OpenAI: Dreaming (unverified)](https://openai.com/index/chatgpt-memory-dreaming/) ·
[Cursor rules](https://cursor.com/docs/context/rules) ·
[Cursor 1.0 changelog](https://cursor.com/changelog/1-0) ·
[Cursor forum: Rules vs Memories](https://forum.cursor.com/t/rules-vs-memories-and-global-vs-project/137149) ·
[Cascade memories & rules](https://docs.devin.ai/desktop/cascade/memories) ·
[Copilot custom instructions support](https://docs.github.com/en/copilot/reference/custom-instructions-support) ·
[Copilot AGENTS.md changelog](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/) ·
[Copilot JetBrains /memory changelog](https://github.blog/changelog/2026-03-11-major-agentic-capabilities-improvements-in-github-copilot-for-jetbrains-ides/) ·
[Gemini CLI GEMINI.md](https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.md) ·
[Gemini CLI save_memory](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/memory.md) ·
[gemini-cli#10702](https://github.com/google-gemini/gemini-cli/issues/10702) ·
[gemini-cli#11488](https://github.com/google-gemini/gemini-cli/issues/11488) ·
[Simon Willison: Comparing Claude and ChatGPT memory](https://simonwillison.net/2025/Sep/12/claude-memory/) ·
[Simon Willison: How to Fix Your Context](https://simonwillison.net/2025/Jun/29/how-to-fix-your-context/) ·
[Harper Reed: My LLM codegen workflow atm](https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/) ·
[Harper Reed: Basic Claude Code](https://harper.blog/2025/05/08/basic-claude-code/) ·
[Mitchell Hashimoto: Vibing a Non-Trivial Ghostty Feature](https://mitchellh.com/writing/non-trivial-vibing) ·
[Mitchell Hashimoto: My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey) ·
[badlogic: Context Compaction Research](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f) ·
[Hugo Sequier: Second Brain for Claude Code](https://medium.com/@sequierh/how-i-built-a-second-brain-for-claude-code-b49b3104b386) ·
[obsidian-second-brain](https://github.com/eugeniughelbur/obsidian-second-brain)
