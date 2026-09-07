# Research: Andrej Karpathy on LLM memory, the LLM wiki, and agent-maintained files

**Question.** What has Karpathy published (2024-2026) on LLM memory, LLM-maintained knowledge
bases, context engineering, and legible artifacts, and which of it should shape accretion?

**Date.** 2026-09-07.

**Method.** Primary sources: the `llm-wiki` gist read in full via two URLs, its revisions page,
his bearblog posts, his GitHub repos (`autoresearch`, `reader3`), and talk transcripts. X posts
could not be fetched directly (see Unverified); they are quoted from page-title text, which
reliably reproduces the first ~250 characters.

## The primary artifact

**`llm-wiki.md`**: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
(raw: https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw/).
Created 4 April 2026, single revision, 75 lines. Confirmed via
https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f/revisions that it has never
been edited. It followed an X post from 3 April 2026 titled "LLM Knowledge Bases"
(https://x.com/karpathy/status/2039805659525644595) and a follow-up on the "idea file" format
(https://x.com/karpathy/status/2040470801506541998).

The gist is close to what accretion already is. The useful output is less "what to add" and more
"where his version is sharper."

## Patterns

### 1. Compile once, keep current

> "Instead of just retrieving from raw documents at query time, the LLM **incrementally builds
> and maintains a persistent wiki**... The knowledge is compiled once and then *kept current*,
> not re-derived on every query."

> "**the wiki is a persistent, compounding artifact.** The cross-references are already there.
> The contradictions have already been flagged."

Source: the gist.

### 2. Three layers with hard ownership boundaries

> "**Raw sources**... These are immutable: the LLM reads from them but never modifies them. This
> is your source of truth." / "**The wiki**... The LLM owns this layer entirely." / "**The
> schema**: a document (e.g. CLAUDE.md for Claude Code or AGENTS.md for Codex)... This is the key
> configuration file: it's what makes the LLM a disciplined wiki maintainer rather than a generic
> chatbot. You and the LLM co-evolve this over time."

Source: the gist.

### 3. Exactly three operations: ingest, query, lint

> "Periodically, ask the LLM to health-check the wiki. Look for: contradictions between pages,
> stale claims that newer sources have superseded, orphan pages with no inbound links, important
> concepts mentioned but lacking their own page, missing cross-references, data gaps that could
> be filled with a web search."

Source: the gist.

### 4. File good answers back in

> "**good answers can be filed back into the wiki as new pages.** A comparison you asked for, an
> analysis, a connection you discovered: these are valuable and shouldn't disappear into chat
> history. This way your explorations compound in the knowledge base just like ingested sources
> do."

Source: the gist.

### 5. Two navigation files, `index.md` and `log.md`, with a greppable prefix

> "**index.md** is content-oriented... each page listed with a link, a one-line summary, and
> optionally metadata like date or source count... The LLM updates it on every ingest."

> "**log.md** is chronological... append-only... if each entry starts with a consistent prefix
> (e.g. `## [2026-04-02] ingest | Article Title`), the log becomes parseable with simple unix
> tools: `grep "^## \[" log.md | tail -5` gives you the last 5 entries."

Source: the gist.

### 6. Index-first retrieval is enough at moderate scale

> "When answering a query, the LLM reads the index first to find relevant pages, then drills into
> them. This works surprisingly well at moderate scale (~100 sources, ~hundreds of pages) and
> avoids the need for embedding-based RAG infrastructure."

Source: the gist.

### 7. CLI first, MCP second

On the wiki search tool `qmd`:

> "It has both a CLI (so the LLM can shell out to it) and an MCP server (so the LLM can use it
> as a native tool)."

Source: the gist.

> "CLIs are super exciting precisely because they are a 'legacy' technology, which means AI
> agents can natively and easily use them, combine them, interact with them via the entire
> terminal toolkit."

Source: https://x.com/karpathy/status/2026360908398862478 (February 2026).

### 8. Ingest is high-fanout and defaults to supervised

> "A single source might touch 10-15 wiki pages. Personally I prefer to ingest sources one at a
> time and stay involved: I read the summaries, check the updates, and guide the LLM on what to
> emphasize. But you could also batch-ingest many sources at once with less supervision."

Source: the gist.

### 9. Autonomous capture produces slop; intent is the scarce input

> "The human's job is to curate sources, direct the analysis, ask good questions, and think about
> what it all means. The LLM's job is everything else."

Source: the gist.

Corroborated by a practitioner one month in: passive always-on monitoring auto-generated pages
for throwaway Slack threads and meeting transcripts, and "without human intent, the system does
not know what matters." The fix was explicit human commands with the LLM doing classification and
maintenance.
Source: https://www.hadijaveed.me/2026/04/15/i-tried-karpathys-llm-knowledge-base/

### 10. Append-and-review with natural decay

His pre-LLM note system: one text note; new items appended to the top; old items sink;
periodically scroll through, rescue important items back to the top, merge related ones, delete
what never gets revisited. Minimal metadata, only functional tags like `watch:`, `listen:`,
`read:`.
Source: https://karpathy.bearblog.dev/the-append-and-review-note/ (19 March 2025)

### 11. Frontmatter and the link graph as the health dashboard

> "**Dataview** is an Obsidian plugin that runs queries over page frontmatter. If your LLM adds
> YAML frontmatter to wiki pages (tags, dates, source counts), Dataview can generate dynamic
> tables and lists."

> "**Obsidian's graph view** is the best way to see the shape of your wiki: what's connected to
> what, which pages are hubs, which are orphans."

Source: the gist.

### 12. Git is the review UI

> "The wiki is just a git repo of markdown files. You get version history, branching, and
> collaboration for free."

Source: the gist. Reinforced by `reader3`: plain local files instead of a database, "It's not
supposed to be complicated or complex." Source: https://github.com/karpathy/reader3

### 13. Context engineering: the brief is a budget, not a dump

> "+1 for 'context engineering' over 'prompt engineering'. People associate prompts with short
> task descriptions you'd give an LLM in your day-to-day use. When in every industrial-strength
> LLM app, context engineering is the delicate art and science of filling the context window
> with just the right information for the next step."

Source: https://x.com/karpathy/status/1937902205765607626 (25 June 2025). Corroborated at
https://pureai.com/articles/2025/09/23/karpathy-puts-context-at-the-core-of-ai-coding.aspx.
The enumeration of what fills the window in that post could only be recovered through search
snippets (see Unverified).

### 14. LLM OS: the context window is RAM

> "LLM OS. Bear with me I'm still cooking. Specs: - LLM: OpenAI GPT-4 Turbo 256 core (batch
> size) processor @ 20Hz (tok/s) - RAM: 128Ktok - Filesystem: Ada002"

Source: https://x.com/karpathy/status/1723140519554105733

Restated in the 2025 Software 3.0 talk: LLMs "have very strong kind of analogies to operating
systems," the LLM is "a new kind of a CPU equivalent," and "context windows are really kind of
like working memory." Sources: https://www.latent.space/p/s3,
https://singjupost.com/andrej-karpathy-software-is-changing-again/

2026: "In Software 3.0, the context window becomes the main lever" / "What's in the context
window is your lever over the interpreter, and the interpreter is the LLM."
Source: https://karpathy.bearblog.dev/sequoia-ascent-2026/

### 15. Anterograde amnesia

In the Software 3.0 talk, LLMs "suffer from anterograde amnesia": their "weights are fixed, and
their context windows gets wiped." Sources: https://www.latent.space/p/s3,
https://singjupost.com/andrej-karpathy-software-is-changing-again/

On the Dwarkesh podcast (October 2025) he argued humans do not dissolve the context/weights
distinction either: working memory gets wiped and sleep does a lossy consolidation pass.
Source: https://x.com/dwarkesh_sp/status/2055771242620469586 (secondary summary at
https://thezvi.wordpress.com/2025/10/21/on-dwarkesh-patels-podcast-with-andrej-karpathy/)

### 16. System prompt learning: capture procedure, not just facts

> "We're missing (at least one) major paradigm for LLM learning... possibly it has a name, system
> prompt learning? Pretraining is for knowledge. Finetuning (SL/RL) is for habitual behavior."

He describes the LLM "writing a book for itself on how to solve problems" and contrasts it with
memory features that "store per-user random facts" rather than "general/global problem solving
knowledge."
Source: https://x.com/karpathy/status/1921368644069765486 (11 May 2025); quoted also at
https://www.latent.space/p/s3

### 17. Agentic engineering over vibe coding

He retired his own term after a year, preferring "agentic engineering": "'agentic' because the
new default is that you are not writing the code directly 99% of the time, you are orchestrating
agents who do and acting as oversight; 'engineering' to emphasize that there is an art & science
and expertise to it," with core skills of spec design, eval loops, and security oversight.
Sources: https://x.com/karpathy/status/2019137879310836075, reported at
https://thenewstack.io/vibe-coding-is-passe/

"Vibe coding raises the floor... Agentic engineering raises the ceiling. It is the professional
discipline of coordinating fallible agents while preserving correctness, security, taste, and
maintainability." Source: https://karpathy.bearblog.dev/sequoia-ascent-2026/

### 18. Verifiability determines what to automate

> "Traditional software automates what you can specify. LLMs and reinforcement learning automate
> what you can verify."

Source: https://karpathy.bearblog.dev/sequoia-ascent-2026/

### 19. Legibility is the product

> "You can outsource your thinking, but you can't outsource your understanding."

> "They are not just answer machines. They are tools for transforming information into
> understanding."

Source: https://karpathy.bearblog.dev/sequoia-ascent-2026/

> "I have the LLM agent open on one side and Obsidian open on the other. The LLM makes edits
> based on our conversation, and I browse the results in real time: following links, checking the
> graph view, reading the updated pages. **Obsidian is the IDE; the LLM is the programmer; the
> wiki is the codebase.**"

Source: the gist.

### 20. One human-editable policy file; agents write to a narrow surface

In `autoresearch`, agents modify only `train.py`; the human "programs the research org" by
editing `program.md`. Fixed 5-minute experiment budget for comparability; human reviews logs in
the morning.
Source: https://github.com/karpathy/autoresearch

### 21. Ship the idea, not the implementation

> "This is an idea file, it is designed to be copy pasted to your own LLM Agent... Its goal is to
> communicate the high level idea, but your agent will build out the specifics in collaboration
> with you."

> "This document is intentionally abstract... Everything mentioned above is optional and modular:
> pick what's useful, ignore what isn't."

Source: the gist; rationale in https://x.com/karpathy/status/2040470801506541998

## Where his version disagrees with a typical accretion design

1. He has no separate memory engine. The wiki is maintained by a general agent reading a schema
   file. Tooling value is limited to search (`qmd`), and only "at some point... as the wiki
   grows." An engine is justified by determinism and speed on the lint half, not the synthesis
   half.
2. He is anti-embedding by default at moderate scale.
3. He keeps the human in every ingest. Hooks that fire automatically are the opposite of his
   stated preference, and the one-month practitioner report says autonomy is where it degraded.
4. kepano (Obsidian's creator) recommends vault separation: "Keep your personal vault clean and
   create a messy vault for your agents... I prefer my personal Obsidian vault to be high
   signal:noise." Source: https://x.com/kepano/status/2039831289533227446

## Applied to accretion

Items below are in [ADR-001](../ADR-001-engine-cli-skill.md) and the restructure plan.

| Pattern | What it produced |
|---|---|
| 2, 20, kepano: ownership boundaries | Per-vault write allowlist (`writablePaths`, default `sessions/`, `sessions/digests/`, `proposals/`, `00-Index/log.md`). Hand-authored briefs change only through `apply-proposals`. Sessions are append-only. `SKILL.md` is documented as the co-evolvable schema file. The allowlist answers the messy-vault concern without a second vault. |
| 3: lint as named rules | `accretion garden` output keyed by contradiction, stale, orphan, missing-page, missing-link, gap. The four deterministic ones map to existing modules; contradiction and gap become named LLM steps in the `memory-weekly` skill, each emitting a typed proposal. |
| 5: index.md and log.md | Engine writes append-only `00-Index/log.md`, one line per event in a fixed grammar: `## [YYYY-MM-DD] capture\|digest\|proposal\|applied\|archive \| <title> \| <path>`. `accretion index` regenerates `00-Index/index.md`. |
| 6: index-first, embeddings as a scale trigger | Vault config `semantic: "auto" \| true \| false`. Keyword plus routing until a curated-note threshold (default 300). No mandatory index build on a cold vault. Passive recall is keyword-only by default. |
| 4: file good answers back in | Skill section "Promote an answer" and `accretion propose --from-stdin`. |
| 16: procedural memory | `type/playbook` note convention; routing treats playbooks like briefs. |
| 18: verifiable versus unverifiable | ADR rule: engine = deterministic testable steps; LLM = synthesis only; human = approval of synthesis. |
| 9: intent gates capture | Capture keeps its threshold gate and opt-in mapping; passive recall reads but never writes; no auto-digest on Stop. |
| 11: frontmatter as dashboard | Every generated note carries `sources`, `last_reviewed`, `generated_by`; `garden` lints their presence. |
| 10: promote / merge / drop | The weekly skill's resurface step reports in exactly these three verbs. |
| 7: CLI plus MCP, CLI first | Evidence for the MCP decision in [mcp-vs-cli.md](mcp-vs-cli.md). |
| 12: git as review UI | Deferred: proposals as a git branch so review is `git diff` and `git merge`. |
| 15: lossy consolidation is a feature | Kept as guidance: digests compress hard; the session log is the recovery path. |

## Unverified

- X/Twitter is not fetchable. `x.com`, `publish.x.com/oembed`, `threadreaderapp`, and `xcancel`
  all returned HTTP 402/403/captcha. Every tweet above is quoted from X page-title text surfaced
  in search results, which reliably reproduces the first ~250 characters. The tails of all quoted
  tweets are unverified, including the full enumeration in the context-engineering post (task
  descriptions / few-shot / RAG / tools / state and history / compacting) and the full "agentic
  engineering" definition.
- `HELLO.md` (https://gist.github.com/karpathy/fb64880bf1f99d58d6c759c966616922, 21 April
  2026), described as being about Claude instances and continuity, could not be read; the fetch
  tool refused to reproduce it. It may be relevant to agent memory and is worth a manual read.
- "CLI at the top, API in the middle, MCP at the bottom": attributed to Karpathy only via a
  third-party Substack note (https://substack.com/@aakashgupta/note/c-236654027). No primary
  source found. The verified primary claim is only the weaker "CLIs are a legacy technology
  agents use natively" post.
- "90% of your AI coding bill is paying for context you didn't need to send": attributed to
  Karpathy only by engagement-farming accounts. No primary source. Treat as fabricated.
- A "12-page PDF on Graph Engineering" by Karpathy appears only in viral-thread posts. No such
  artifact on his gists, GitHub, or blog. Treat as false.
- The 65-line, 100K-star `CLAUDE.md` is by Forrest Chang, derived from Karpathy's complaints
  about Claude's coding failure modes. Karpathy did not author it.
- Gist engagement numbers conflict across sources (5k / 13k / 47k stars). The gist listing page
  reported 47,451 stars, 9,749 forks, 1,096 comments at fetch time.
- The "MindBase" follow-up surfaced as if authored by Karpathy; it is a third-party comment on his
  gist.
- Karpathy did not revise his own gist. The revisions page shows a single 4 April 2026 version.

Sources fetched (20): gist raw and HTML, gist revisions page, gist.github.com/karpathy index,
karpathy.ai, karpathy.ai/tweets.html, karpathy.bearblog.dev/blog/, `/the-append-and-review-note/`,
`/year-in-review-2025/`, `/sequoia-ascent-2026/`, `/digital-hygiene/`, github.com/karpathy repos,
github.com/karpathy/autoresearch, github.com/karpathy/reader3, latent.space/p/s3, singjupost
transcript, pureai.com, hadijaveed.me, rdworldonline.com, deepakness.com.
