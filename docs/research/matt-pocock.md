# Research: Matt Pocock on agent memory, skills, and writing for agents

**Question.** What has Matt Pocock published (2025-2026) on agent memory, skills, CLIs versus
MCP tools, and writing for agents, and which of it should shape accretion's restructure into an
engine, CLI, skill, and hooks?

**Date.** 2026-09-07.

**Method.** Primary sources only: his GitHub repos read via raw files, the published plugin
artifact `mattpocock-skills@1.2.3` (same files as the GitHub URLs cited, read locally so a
summarizer could not mangle them), aihero.dev `.md` twins of his posts, and the
`dictionary-of-ai-coding` repo. Quotes are verbatim from those files. Anything that could not be
confirmed at a primary source is listed under "Unverified" at the end.

## The frame

His position rests on one claim: **"AI is not a super-powered developer. It's a new starter with
no memory."** ([How to make codebases AI agents love](https://www.aihero.dev/how-to-make-codebases-ai-agents-love)).
Skills, CONTEXT.md, and pointers are scaffolding against that.

His definition of what accretion is: a memory system has a **write path** (the agent documents
discoveries as files during work) and a **read path** (the harness reloads them at session
start). As memories accumulate, most implementations load **"a one-line index and leave the
bodies behind context pointers"**, and stored memories are **secondary sources that go stale**.
([dictionary/Memory system.md](https://github.com/mattpocock/dictionary-of-ai-coding/blob/main/dictionary/Memory%20system.md))

## Patterns

### 1. Context pointers are the primary unit; the pointer's wording is the bug surface

> "The pointer's _wording_, not its target, decides when the agent reaches the material, and how
> reliably. A must-have target behind a weakly worded pointer is a **variance bug**: sharpen the
> wording first, and inline the material only if sharpening fails."

Three rules: front-load the leading word; one trigger per branch ("Synonyms that rename a single
branch are one branch written twice"); cut identity the body already carries.
Source: [writing-for-agents/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md)

### 2. Two loads: context load versus cognitive load

> "**Context load**: the cost of always-loaded material on the agent's window... spending tokens
> and attention whether or not it fires. **Cognitive load**: the cost on the human: which
> documents exist and when to reach for each. The human is the index. Not a cost to minimise; it
> is the price of human agency."

Source: same file.

### 3. Model-invoked versus user-invoked is a load decision

> "Pick model-invocation only when the agent must reach the skill on its own, or another skill
> must. If it only ever fires by hand, make it user-invoked and pay no context load."

A model-invoked skill's description is "the skill's top-level context pointer, forced to stay
loaded at all times: permanent context load in exchange for discoverability." User-invoked
means `disable-model-invocation: true`, and the description becomes human-facing with trigger
lists stripped.
Source: [writing-for-agents/SKILL-MECHANICS.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL-MECHANICS.md)

### 4. Progressive disclosure is a variance lever, not a token optimisation

> "**Progressive disclosure** is the move down the ladder... Not primarily a token optimisation:
> it is how the hierarchy is protected. **Branching is the cleanest disclosure test: inline what
> every branch needs, and push behind a pointer what only some branches reach.**"

The ladder: in-file step, in-file reference, disclosed reference. The failure mode is sprawl,
"a document simply too long, even when every line is live and unique."
Sources: [SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md), [dictionary/Progressive disclosure.md](https://github.com/mattpocock/dictionary-of-ai-coding/blob/main/dictionary/Progressive%20disclosure.md)

### 5. MCP tool schemas are billed on every turn

Measured with a logging proxy: **"69 tools · 154,946 tool bytes · 65,538 real input tokens"**,
individual tools at roughly 5307 / 2245 / 1942 tokens each. **"It goes out on every request, and
you're billed for it every turn."** Mechanic: `permissions.deny` with a bare tool name removes the
definition from the payload; a scoped rule only blocks execution and keeps the definition.
Reported result: **"Mine dropped by tens of thousands of tokens per turn."**
Source: [How to kill the bloat in Claude Code's system prompt](https://www.aihero.dev/how-to-kill-the-bloat-in-claude-codes-system-prompt)

Note: this is the quantified point. No primary Pocock source argues "CLI beats MCP" directly
(see Unverified).

### 6. Negation backfires; prompt the positive

> "Steering by prohibition drags the forbidden behaviour into context and makes it _more_
> available, not less. _Don't think of an elephant_, and the elephant is all there is... Prompt
> the **positive**: state the target behaviour ('write one-line comments') so the banned one is
> never spoken."

Source: [writing-for-agents/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md)

### 7. The no-op test, and it is model-relative

> "Hunt **no-ops** sentence by sentence: an instruction the model already obeys by default pays
> load to say nothing. The test, does it change behaviour versus the default?, is
> **model-relative, not reader-relative**: two people disagreeing about a no-op disagree about
> the default, and settle it by **running the document, not by debate**. When a sentence fails,
> delete the whole sentence rather than trim words from it."

The docs page adds: **"Its default move is deletion, not explanation."** It is working if
**"Nothing is stated twice, in any form. Duplication is the most reliable sign a document was
never tested."**
Sources: [SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md), [aihero.dev/skills-writing-for-agents](https://aihero.dev/skills-writing-for-agents)

### 8. The environment is a source of truth; a doc restating it is a cache

> "The **environment** is a source of truth too: `package.json` scripts, config files, the
> directory layout, `--help` output, and a document that restates it is a **cache**: a copy of a
> lookup, earning its load only when the lookup is expensive. **Cache what the agent cannot find
> by looking**: the unwritten convention, the reason behind a choice, the gotcha no config
> confesses."

Failure fate: sediment, "stale layers that settle because adding feels safe and removing feels
risky."
Source: same file.

### 9. Leading words

> "A **leading word** is a compact concept already living in the model's pretraining that the
> agent thinks with while running the document (_lesson_, _fog of war_, _tracer bullets_).
> Repeated as a token, never as a sentence, it accumulates a distributed definition."

Caveat: **"a made-up word recruits no priors: you pay in definition tokens what a pretrained word
gives free."**
Source: same file.

### 10. Completion criteria: clarity plus demand

> "**Clarity**: can the agent tell done from not-done? A vague bound ('understanding reached')
> invites **premature completion**... **Demand**: how much it requires. 'Every modified model
> accounted for' forces thorough work where 'produce a change list' does not."

**"The strongest criteria are both checkable and exhaustive."**
Source: same file.

### 11. CONTEXT.md is an opinionated glossary and nothing else

Format: term, one to two sentence definition, an `_Avoid_:` list of rejected synonyms. Rules:
"Be opinionated", "Keep definitions tight... Define what it IS, not what it does", project-specific
terms only. **"`CONTEXT.md` should be totally devoid of implementation details... It is a glossary
and nothing else."** The failure he names: **"Left unchecked, models treat 'write to
`CONTEXT.md`' as permission to persist every answer you give, and the file turns into a running
spec; this is the most-reported problem with the skill, across several models."** Health signal:
**"`CONTEXT.md` gets shorter as often as it gets longer."**
Sources: [domain-modeling/CONTEXT-FORMAT.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/CONTEXT-FORMAT.md), [domain-modeling/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md), [aihero.dev/skills-domain-modeling](https://aihero.dev/skills-domain-modeling), [skills/CONTEXT.md](https://github.com/mattpocock/skills/blob/main/CONTEXT.md)

### 12. Write inline, not batched; create files lazily

> "When a term is resolved, update `CONTEXT.md` right there. **Don't batch these up; capture
> them as they happen.**"

Reason: **"the batched version is a summary of a session, and the inline version is the
session's actual output."** Also: **"Create files lazily, only when you have something to
write."** If files do not exist, **"proceed silently. Don't flag their absence; don't suggest
creating them upfront."**
Sources: [domain-modeling/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md), [setup-matt-pocock-skills/domain.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/domain.md), [aihero.dev/skills-domain-modeling](https://aihero.dev/skills-domain-modeling)

### 13. A three-test bar for what gets persisted

An ADR is offered only when all three hold: **"Hard to reverse"**, **"Surprising without
context"**, **"The result of a real trade-off."** Miss one and there is no ADR: "An
easily-reversed decision will just get reversed; an unsurprising one is nobody's question."

Paired with cross-referencing memory against code and surfacing the contradiction out loud:
*"Your code cancels entire Orders, but you just said partial cancellation is possible, which is
right?"*
Sources: [domain-modeling/ADR-FORMAT.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/ADR-FORMAT.md), [setup-matt-pocock-skills/domain.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/domain.md)

### 14. Store rejections, not just decisions

A directory of one file per concept recording rejected requests, serving **"Institutional
memory"** and **"Deduplication: when a new issue comes in that matches a prior rejection, the
skill can surface the previous decision instead of re-litigating it."** Written **"in a relaxed,
readable style, more like a short design document than a database entry."**
Source: [triage/OUT-OF-SCOPE.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/OUT-OF-SCOPE.md)

### 15. Durable memories describe behaviour, never paths or line numbers

> "Write the brief so it stays useful even as files are renamed, moved, or refactored."
> "Don't reference file paths: they go stale. Don't reference line numbers."

Source: [triage/AGENT-BRIEF.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/AGENT-BRIEF.md)

### 16. Index versus store; de-duplication by pointer

> "The map is an index, not a store. It lists the decisions made and points at the tickets that
> hold their detail; a decision lives in exactly one place, its ticket, so the map never restates
> it, only gists it and links."

> "Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues,
> commits, diffs). Reference them by path or URL instead."

Handoff additions: save to the OS temp directory, include a "suggested skills" section, redact
secrets.
Sources: [wayfinder/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md), [productivity/handoff/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md)

### 17. Every secondary source carries a pointer home

> "A well-made secondary source carries a context pointer back to its original."

Secondary sources are **"lossy by construction"** and fail by information loss and by drift
(the original changes, the summary does not), after which agents **"work confidently from wrong
information."**
Source: [dictionary/Secondary source.md](https://github.com/mattpocock/dictionary-of-ai-coding/blob/main/dictionary/Secondary%20source.md)

### 18. Attention budget

> "Each token possesses limited influence... This allocation remains constant per-token and
> doesn't scale with larger contexts."

An instruction dominant at 10k tokens becomes **"background hum at 150k"**. Remedies: keep
windows compact, clear accumulated content, re-state critical constraints rather than relying on
initial placement.
Source: [dictionary/Attention budget.md](https://github.com/mattpocock/dictionary-of-ai-coding/blob/main/dictionary/Attention%20budget.md)

## AGENTS.md / CLAUDE.md specifics

From [A complete guide to AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md):

- **"Frontier thinking LLMs can follow ~ 150-200 instructions with reasonable consistency."**
- Minimum viable AGENTS.md: one-sentence project description, package manager if not npm,
  non-standard build/typecheck commands. *"That's genuinely sufficient. Everything else belongs
  elsewhere."*
- Outdated info in a file read on every request **"actively poisons the context"**,
  *"particularly dangerous with file paths that change constantly."*
- Root AGENTS.md is for what is relevant to every task; one domain per separate file; nested
  files merge in monorepos.
- **"The ideal `AGENTS.md` is small, focused, and points elsewhere."**
- *"Material applying in one context out of ten pays unnecessary context load nine times over
  elsewhere."* ([aihero.dev/skills-writing-for-agents](https://aihero.dev/skills-writing-for-agents))

## Repo conventions

From [skills/CLAUDE.md](https://github.com/mattpocock/skills/blob/main/CLAUDE.md) and the
[README](https://github.com/mattpocock/skills):

- Bucket folders with promotion semantics: `engineering/`, `productivity/` are promoted and
  shipped; `misc/`, `in-progress/`, `deprecated/` must not appear in the plugin or docs.
- Docs pages have a fixed four-section shape: *What it does*, *When to reach for it*, *Common
  questions*, *It's working if*. The last is observable behavioural signals, not features.
- Router skill: *"When user-invoked skills multiply past what you can remember, that piled-up
  cognitive load is cured by a router skill."* Warning: *"a new skill it never mentions, or a
  stale one it still routes to, is a router that lies."*
- Dual install: plugin is "managed, read-only bundle... you subscribe rather than fork";
  `npx skills add` copies editable files. Installing both gives every skill twice.
- Product stance: *"These skills are designed to be small, easy to adapt, and composable"*,
  contrasted with process-owning frameworks that *"take away your control and make bugs in the
  process hard to resolve."*

## Deep modules

`codebase-design` defines depth as leverage and rejects the ratio framing: *"Depth as ratio of
implementation-lines to interface-lines (Ousterhout): rewards padding the implementation. We use
depth-as-leverage instead."* Interface means everything a caller must know: "invariants, ordering
constraints, error modes, required configuration, and performance characteristics."

Four principles: the deletion test ("Imagine deleting the module. If complexity vanishes, it was
a pass-through"); "The interface is the test surface"; "One adapter means a hypothetical seam.
Two adapters means a real one"; depth is a property of the interface, not the implementation.
From `DEEPENING.md`: replace, don't layer; "Old unit tests on shallow modules become waste once
tests at the deepened module's interface exist, delete them."
Sources: [codebase-design/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md), [codebase-design/DEEPENING.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DEEPENING.md)

## Applied to accretion

Items below are in [ADR-001](../ADR-001-engine-cli-skill.md) and the restructure plan.

| Pattern | What it produced |
|---|---|
| 8, 13: cache what the agent cannot find; three-test bar | Write-path admission bar. A memory earns a note only if it is a convention, a rationale, or a gotcha the agent cannot `ls` or `--help` its way to. A decision earns a brief section or ADR only if hard to reverse, surprising without context, and a real trade-off. Goes into the `memory-weekly` skill's proposal step and the accretion skill's "Writing notes" section. |
| 14: store rejections | `type/rejected` note convention. Routing and recall surface prior rejections so they are not re-litigated. |
| 15: no paths or line numbers | New `garden` lint: warn on `src/...` paths and `:NN` line references in briefs and knowledge notes. |
| 17: pointer home | `garden` lint: a generated note without provenance is a structure issue. Proposals carry session and date; recall injections state path and route method in the header. |
| 18, AGENTS.md guide: attention budget | Confirms prompt-time injection over a large session-start dump. `SessionStart` injection is at most one line. |
| 1, 3, 4, 6, 7: skill authoring | Governs `SKILL.md`: model-invoked, so the description is written last and pruned hardest; front-load the leading word; one trigger per branch; positive phrasing; no-op test with deletion as default; branching test decides inline versus behind a pointer. Docs get an "It's working if" section per skill. |
| 16: index versus store | Recall injection follows the digest model: hits are title, path, snippet. Bodies live once. |
| 11: gets shorter as often as longer | `garden` reports net brief growth per period; the weekly report states it. |
| Deep modules | The CLI is the seam; CLI plus hooks are already two adapters. The engine's public API documents error modes, ordering, and config, not only types. |
| 12: inline capture | Deferred. Needs an LLM in the loop mid-session. |
| 13: contradiction surfacing | Deferred. Needs an LLM in the loop at recall time. |

## Unverified

- No primary source found for a direct Pocock "CLI over MCP" argument. The inference in pattern 5
  is built from a verified token-cost article plus verified invocation-load mechanics. The listed
  post *"The Problem With MCP: Stateful Servers"* exists in
  [sitemap.md](https://www.aihero.dev/sitemap.md) but 404s at both HTML and `.md`.
- "63% lower token costs via progressive disclosure" (Skills v1.0): aggregator blogs only, no
  primary source.
- Star/fork counts: search results reported 135k, 139k, and 256k across different pages.
  Unreliable; do not cite.
- The X post on context pointers
  ([x.com/mattpocockuk/status/2051587758238371858](https://x.com/mattpocockuk/status/2051587758238371858))
  returned HTTP 402; its content is corroborated by the dictionary entry and SKILL.md, both
  verified.
- "Memory Skill Building" workshop
  ([aihero.dev/workshops/memory-skill-building-w324h](https://www.aihero.dev/workshops/memory-skill-building-w324h))
  404'd, likely gated. Worth a manual look; it is the one source aimed squarely at building a
  memory system rather than using one.
- Skill bodies were read from plugin v1.2.3; `main` may have drifted. The `writing-for-agents`
  GitHub raw fetch corroborated the structure and section names exactly.
