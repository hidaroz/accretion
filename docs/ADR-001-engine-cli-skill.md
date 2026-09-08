# ADR-001: accretion is an engine and a CLI; MCP is an adapter

**Status:** accepted, 2026-09-07.

## Context

accretion started as a long-running HTTP MCP server with 21 tools over Obsidian vaults. Three
things changed the picture.

**The author stopped using the server.** On 2026-08-13 the HTTP server was retired from daily
use in favour of a small CLI extracted from the same retrieval code, plus a Claude Code skill
that teaches the agent when to call it. Session capture (a SessionEnd hook) and the weekly
curation loop never needed the server; they call the `scripts/*.mjs` wrappers directly. The
server was the centre of the repo and the least-used part of the system.

**A review of the code found the surface was the problem, not the retrieval.** Twenty-one tools
where six would do. Three search tools plus `get_brief` plus `get_context` are one search with a
mode. Seven lifecycle tools duplicate seven CLI scripts, and the weekly command says it cannot use
the MCP versions. A fire-and-forget `git commit` on every write races under concurrent agent
writes. The brief map is a second source of truth outside the notes. The HTTP stack (bearer
auth, CORS, rate limiting, session TTL, DNS-rebinding guard, a launchd agent) exists only
because there is no stdio transport. The retrieval, routing, staleness, proposal and eval code
underneath is sound and already written as pure functions.

**Primary-source research on how agents should reach a tool** ([docs/research/mcp-vs-cli.md](research/mcp-vs-cli.md)).
The token cost of MCP tool definitions is now mostly absorbed by the clients: Claude Code,
Codex and Cursor all defer tool definitions and discover on demand. What remains are reach (a
client with no shell can only use MCP), state (a stdio server keeps the embedding model warm),
validation (MCP has a schema layer; a CLI does not), and Anthropic's own split: MCP for external
data, skills for procedures and reference. Both vendors document that the mechanisms compose, and
Karpathy's `qmd` ships as both a CLI and an MCP server. Research on Matt Pocock
([docs/research/matt-pocock.md](research/matt-pocock.md)) and Andrej Karpathy
([docs/research/karpathy.md](research/karpathy.md)) supplied design rules for the write path,
the lint, the skill, and passive recall.

## Decision

1. **The engine is the product.** `src/engine/` is a pure library: vault access, retrieval
   (keyword, semantic, RRF fusion, brief routing), context assembly, lifecycle (session scan,
   digests, staleness, proposals, archive, resurface, garden), eval, config. No git, no stdout
   logging, no environment reads outside `config/`. Callers own process concerns.

2. **The `accretion` binary is the primary surface.** One CLI with subcommands for retrieval
   (`search`, `brief`, `context`, `read`, `list`, `tags`), lifecycle (`digest-candidates`,
   `stale-briefs`, `archive`, `apply-proposals`, `resurface`, `garden`, `index`, `log`,
   `propose`), and operations (`eval`, `doctor`, `setup-vault`, `bootstrap`, `commit`). JSON
   output shapes are the API and are kept compatible with the private CLI that proved them.
   `scripts/*.mjs` become deprecation shims for one release, then go.

3. **A skill and two hooks teach and automate the agent.** `plugin/skills/accretion/SKILL.md`
   carries the retrieval rule (brief when domain-shaped, hybrid otherwise, grep for exact
   strings), trusts abstention, and leaves git to the committer. A `SessionEnd` hook captures
   sessions. A `UserPromptSubmit` hook performs passive recall: route the prompt to a brief or
   inject three hits, keyword-only by default, framed as retrieved data, never raw sessions. All
   ship as a Claude Code plugin with the CLI on `PATH`.

4. **MCP is a thin stdio adapter, at most six tools, generated from the CLI command spec.** Each
   command exports `{name, description, input: zodSchema, run}`; the CLI and the MCP server both
   render from it, so there is one implementation and a parity test. Tools: `search`, `brief`,
   `context`, `read`, `list`, `propose`. Lifecycle stays CLI-only. The HTTP transport, bearer
   auth, CORS, rate limiting, session TTL, DNS-rebinding guard, server launchd template and
   Dockerfile server target are removed.

5. **Git has one writer.** `accretion commit` (reads `gitAutoCommit` and `gitAutoPush` from the
   vault registry) runs on a timer. The engine never commits. The capture hook writes its note
   and either spawns a detached commit or leaves it to the timer; SessionEnd hooks share a 1.5 s
   budget and cannot afford `git` inline.

6. **The engine writes only to an allowlist.** Per vault, `writablePaths` defaults to
   `sessions/`, `sessions/digests/`, `proposals/`, `00-Index/log.md`. Hand-authored briefs change
   only through `apply-proposals`. Sessions are append-only.

7. **Automate what can be verified.** The engine performs deterministic, testable steps. An LLM
   performs synthesis only (digests, proposals, contradiction and gap detection). A human
   approves synthesis before it reaches a brief. New features are placed on this line before
   they are built.

8. **Retrieval is index-first; embeddings are a scale trigger.** Vault config `semantic` is
   `"auto"` by default: keyword plus routing until a curated-note threshold, then semantic joins.
   A cold vault has no mandatory index build.

### Integrated patterns

One line each; sources and quotes are in the research files.

- Write-path admission bar: a memory earns a note only if it is a convention, rationale, or gotcha the agent cannot find by looking; a decision earns a brief section only if hard to reverse, surprising without context, and a real trade-off ([Pocock](research/matt-pocock.md), patterns 8 and 13).
- Store rejections: `type/rejected` notes, surfaced by routing and recall ([Pocock](research/matt-pocock.md), 14).
- No paths or line numbers in durable notes; `garden` lints for them ([Pocock](research/matt-pocock.md), 15).
- Every generated note carries provenance; `garden` lints for it; recall injections state path and method ([Pocock](research/matt-pocock.md), 17).
- Re-inject at the moment of relevance rather than a large session-start dump ([Pocock](research/matt-pocock.md), 18).
- Skill authoring: model-invoked, description written last and pruned hardest, positive phrasing, no-op test, branching test for disclosure ([Pocock](research/matt-pocock.md), 1, 3, 4, 6, 7).
- Digest is an index of gists plus pointers; bodies live once; recall follows the same shape ([Pocock](research/matt-pocock.md), 16).
- `garden` reports net brief growth; shorter as often as longer is the healthy signal ([Pocock](research/matt-pocock.md), 11).
- The CLI is the seam; the engine's public API documents error modes, ordering and config ([Pocock](research/matt-pocock.md), deep modules).
- Three layers with hard ownership: raw immutable, wiki LLM-owned, schema co-evolved ([Karpathy](research/karpathy.md), 2).
- Lint as six named rules: contradiction, stale, orphan, missing-page, missing-link, gap ([Karpathy](research/karpathy.md), 3).
- Append-only `00-Index/log.md` with a greppable line grammar, and a regenerated `index.md` ([Karpathy](research/karpathy.md), 5).
- Index-first retrieval; embeddings when the vault outgrows it ([Karpathy](research/karpathy.md), 6).
- File good answers back in: `accretion propose --from-stdin` ([Karpathy](research/karpathy.md), 4).
- Procedural memory: `type/playbook` notes ([Karpathy](research/karpathy.md), 16).
- Human intent gates capture; recall reads but never writes ([Karpathy](research/karpathy.md), 9).
- Frontmatter is the dashboard: `sources`, `last_reviewed`, `generated_by` on every generated note ([Karpathy](research/karpathy.md), 11).
- Resurface reports in three verbs: promote, merge, drop ([Karpathy](research/karpathy.md), 10).
- Cap and frame the injection, and render temporal validity inline: Mem0's hook injects at most five memories with no model call at capture; Zep renders valid-from and valid-to on each fact; Letta's MemFS keeps only `system/` always loaded ([memory products survey](research/memory-products-2026.md), sections 1 to 3 and 11).
- Only a description enters context by default and the body is fetched on demand; add expiry and a review date to durable notes, because un-expired corrections contradict each other within weeks ([agent-native survey](research/agent-native-memory-2026.md), Cascade `model_decision` trigger and claude-code issue 34776).
- Maintenance, not ingest, is where file-based memories die; validation is the first thing cut under cost pressure; the defensible claim is the combination of markdown governance, abstaining routing, propose-only writes, passive recall and negative-case evals, not any one of them ([llm-wiki landscape](research/llm-wiki-landscape-2026.md), recurring patterns and closing section).

## Consequences

- The repo's centre moves from `src/index.ts` to `src/engine/index.ts` and `src/cli/`. README,
  SECURITY.md and CONTRIBUTING are rewritten around the CLI once it exists.
- Dependencies `express`, `cors`, `express-rate-limit` and `dotenv` are removed. `esbuild` is
  added to bundle hooks to single files, which retires the three hand-duplicated `expandHome`
  copies.
- The threat model shrinks to: a globally installed capture hook (opt-in per project), a
  prompt-time recall hook (reads only, injects curated notes with framing), a skill, and a local
  process. No listening socket by default.
- Config moves to `~/.config/accretion/vaults.json` with a fallback read of the legacy
  `~/.config/obsidian-mcp/vaults.json` and a deprecation line on stderr. `accretion doctor`
  offers the migration.
- Behaviour that the eval calibrated is preserved: raw sessions are demoted twice (a 0.3 boost in
  keyword search, a 0.7 weight in fusion); this is now documented in one place and exposed as one
  setting rather than silently compounded.
- The private `vault-search` CLI and `vault-commit.sh` are ported by hand into the public repo.
  Private history is never pushed here.
- Clients without a shell get the six-tool stdio adapter. Clients with a shell are told by the
  skill to use the CLI on `PATH`.
- Every phase leaves `npm test` green and the eval scorecard reproducible; a delta is a
  regression.

## Follow-ups

Named here so they are not re-litigated as scope for this change.

- **Task-level eval.** Built 2026-09-08 as `accretion task-eval` (see evals/README.md). Twenty to thirty real tasks run with and without the vault, judged
  against a rubric, reporting win rate. The prerequisite for earning any auto-apply lane back.
- **LLM-summarised capture.** Decisions and open threads at session end instead of the first
  hundred characters of each message. Must run detached; the SessionEnd budget is 1.5 s.
- **sqlite-vec index** behind the existing `IndexStore` interface, replacing the JSON vector
  cache; runs on Node's built-in SQLite.
- **`@huggingface/transformers` v3** replacing the deprecated `@xenova/transformers` v2, behind
  the existing `Embedder` interface.
- **Contradiction surfacing at recall time** and **inline capture mid-session**; both need an LLM
  in the loop.
- **Proposals as a git branch** so review is `git diff` and approval is `git merge`.

## Implementation notes

Decisions taken while carrying this out, recorded so they are not rediscovered.

- `VaultManager` resolves its root through `realpath`. Path safety compares real paths, so a
  vault reached through a symlink (macOS `/var`, a linked Documents folder) rejected every note
  and indexed nothing, with no error.
- Recall's hits tier has a domain-vocabulary gate: a prompt must share a routing keyword or a
  curated note's title or slug token with the vault before any hit is injected. Without it,
  fuzzy keyword search matched off-domain prompts on common words. The tokenizer stop list was
  widened for the same reason (function words that appear in titles); the eval scorecard did
  not move.
- Retrieval walkers skip `sessions/archive/`. Archived sessions were documented as out of the
  live index and were being re-indexed on every full read.
- `accretion commit` unstages the derived `.mcp/` files (index snapshot, embeddings, logs)
  regardless of the vault's `.gitignore`; older vaults predate the ignore entries.
- Brief routing keywords in frontmatter (`keywords:`, `aliases:`) merge with
  `.mcp/brief-map.json`; the file map wins on conflict, because it is where a person writes
  "this word means that brief" on purpose.
- The plugin installs by symlink into `~/.claude/skills/accretion`, which Claude Code documents
  as loading a plugin without a marketplace. Verified in headless sessions: skills, both hooks,
  and `bin/` load from there. Bootstrap strips the `settings.json` hook entries the plugin
  replaces, so a previous hooks-mode install does not fire twice.
- The keyword index is snapshotted to `.mcp/search-index.json` and refreshed by mtime, so a
  one-shot CLI call costs tens of milliseconds instead of re-indexing the vault.
- `eval`, `doctor`, `setup-vault` and `bootstrap` remain scripts behind CLI subcommands. Porting
  them into `src/cli/` is mechanical and deferred; their interfaces are the subcommands.
- The weekly loop's Bash allowlist is `Bash(accretion *)` and `Bash(osascript *)`. The skill
  never runs git; `accretion commit` does, reading push policy from the registry.
