# accretion

<p align="center">
  <img src="docs/banner.png" alt="accretion: layers of session notes compressing into digests and briefs, with one thread tracing an answer back to its source" width="100%">
</p>

Curated, human-readable **memory for AI coding agents**, kept in Obsidian markdown vaults and
served by one CLI. It indexes one or more vaults, routes questions to curated **briefs** with a
gate that prefers abstaining over guessing, fuses keyword and local semantic retrieval, captures
every coding session, and runs a weekly curation loop that proposes rather than edits.

The thesis: memory should compound and stay *legible* (markdown plus git), not accumulate as
opaque vectors. The engine is a library with an `accretion` binary over it; agents reach it
through the CLI, a skill that teaches when to use it, and two hooks (session capture, prompt-time
passive recall), all shipped as a Claude Code plugin. A six-tool stdio MCP adapter exists for
clients that have no shell. The decision and its evidence: [`docs/ADR-001-engine-cli-skill.md`](docs/ADR-001-engine-cli-skill.md).

---

## Prerequisites

- **Node ≥ 20** (22 recommended, see [`.nvmrc`](.nvmrc))
- **git**
- macOS or Linux. The scheduled pieces (committer, weekly loop) use macOS `launchd`.

## Install

```bash
git clone https://github.com/hidaroz/accretion.git
cd accretion
npm install
npm run build
node scripts/bootstrap.mjs
```

`bootstrap` is idempotent and backs up anything it overwrites. By default it installs in
**plugin mode**: it symlinks [`plugin/`](plugin/) into `~/.claude/skills/accretion`, where Claude
Code loads it as a plugin on every session, and links `~/.local/bin/accretion` so the CLI is on
`PATH`. From the plugin Claude Code gets the skills `/accretion:memory` and
`/accretion:memory-weekly`, the two hooks, `accretion` on the Bash tool's `PATH`, and the MCP
adapter. It also migrates a registry from the pre-rename `~/.config/obsidian-mcp/vaults.json`.

Other modes: `--install hooks` copies the hooks into `~/.claude/hooks/` and wires them into
`~/.claude/settings.json` instead of relying on plugin loading. `--committer` writes the launchd
committer agent (macOS). `--skip-install` skips `npm install` and the build.

To try the plugin for one session without installing: `claude --plugin-dir ./plugin`.

> ### What the hooks do, read this before running bootstrap
>
> **Capture** runs at the end of every Claude Code session. For a project mapped to a vault it
> writes a note with the session's topics, changed file paths, and shell commands, then hands git
> to `accretion commit`. **Recall** runs on every prompt in a mapped project and may place a
> brief or three related notes in front of the model, framed as retrieved reference material.
>
> **Both are opt-in per project.** `_default: null` in the project map means an unmapped
> directory records nothing and recalls nothing. Setting `_default` to a vault id turns both on
> everywhere; that is a deliberate choice.
>
> Credentials are stripped from captured notes (vendor tokens, JWTs, URL-embedded passwords,
> `FOO_SECRET=` assignments). The redaction is deliberately blunt and it is **not a guarantee**.
> Treat a vault as containing whatever you pasted into a session.

## Configure

**Registry:** `~/.config/accretion/vaults.json` (`VAULTS_CONFIG` overrides; the legacy path is
read with a warning). Create it with:

```bash
accretion setup-vault --id work --path ~/Documents/work-vault --display "Work" --default
```

Per-vault fields:

| Field | Default | Purpose |
|---|---|---|
| `id`, `path`, `displayName` | required | Identity. `path` may use `~`. |
| `default` | false | The vault used when `--vault` is omitted. At most one. |
| `gitAutoCommit`, `gitAutoPush` | true, false | Read only by `accretion commit`. Nothing leaves your machine unless you enable push. |
| `semantic` | `"auto"` | Embeddings on once the curated layer has `semanticThreshold` (300) notes; `true` or `false` to force. |
| `writablePaths` | `sessions/`, `proposals/`, `00-Index/log.md`, `00-Index/index.md` | Where the engine may write. Curated notes change only through applied proposals. |
| `recall` | `{ budget: 1500, mode: "brief-or-hits", semantic: false }` | Passive recall: token ceiling, `brief-only`/`brief-or-hits`/`off`, whether the hook loads embeddings. |

**Project map:** `~/.claude/hooks/project-vault-map.json` (`PROJECT_VAULT_MAP` overrides). Keys
are directory basenames, values are vault ids. `setup-vault --project acme-foo,acme-bar` writes
entries for you.

Environment: see [`.env.example`](.env.example) for `DISABLE_EMBEDDINGS`, `TRANSFORMERS_CACHE`,
`EMBEDDING_MODEL`, `LOG_LEVEL`.

## Use

```bash
accretion brief routing                         # domain-shaped question: the one brief, or an honest abstention
accretion search "why do sessions rank lower"   # hybrid search: ranked paths + snippets
accretion context retrieval capture             # several briefs under one token budget
accretion read 02-Retrieval/brief-hybrid-retrieval.md
accretion log --last 5                          # what changed in the vault recently
accretion recall "why did we pick RRF"          # what the recall hook would inject, inspectable
accretion propose --title "..." --target 03-Architecture/brief-auth.md --source sessions/2026/09-07/x.md --body "..."
```

Every command takes `--vault <id>` and `--json`; data commands (digests, lints, archive) always
print JSON; `accretion <command> --help` is derived from the input schema. Retrieval commands
use a keyword-index snapshot in the vault's `.mcp/`, refreshed against file mtimes, so a call
costs tens of milliseconds. `--keyword-only` skips embeddings for one call.

**The skill.** `/accretion:memory` tells the agent when to reach for a brief versus search, to
trust an abstention, what earns a note (a convention, a rationale, a gotcha, a decision that was
hard to reverse and surprising without context), and to file answers back with `propose` rather
than editing briefs. Agents write notes with their own editor tools; the engine's write
allowlist only governs the engine.

**Passive recall.** On each prompt in a mapped project, the hook routes the prompt; a confident
route injects that brief truncated to the budget, otherwise up to three curated hits (title,
path, snippet), otherwise nothing. Raw session notes are never injected. Short prompts and slash
commands are skipped, a brief is not injected twice in one session, and a domain-vocabulary gate
keeps off-domain prompts silent. Each decision is logged to `<vault>/.mcp/recall-log.jsonl`.

**Note types the engine understands:** `type/brief` (one per domain, the curated layer; routing
keywords in `keywords:` or `aliases:` frontmatter, `.mcp/brief-map.json` overrides them),
`type/playbook` (how we do X here), `type/rejected` (considered and declined, so it is not
re-litigated), `type/note` (evergreen, cites a `Source:`), `type/digest` (weekly synthesis).

**Event log.** Capture, digests, proposals, applies, archives and index rebuilds each append one
line to `00-Index/log.md`, `## [YYYY-MM-DD] kind | title | path`, so recent activity is a
`grep '^## \[' 00-Index/log.md | tail -5` away with no index at all.

**Git.** `accretion commit` is the only git writer. The launchd committer runs it every twenty
minutes ([`bin/vault-commit.sh`](bin/vault-commit.sh)); the capture hook calls it for its own
note. It pushes only vaults with `gitAutoPush: true` and unstages the derived `.mcp/` files
(index snapshot, embeddings, logs) whatever the vault's `.gitignore` says. List those files in the
`.gitignore` anyway, so a hand-run `git add -A` does not commit them.

## Measuring it

Two evals, both deterministic to run again: `accretion eval` scores retrieval and routing against
known-answer cases; `accretion task-eval` answers real questions with and without the vault through
`claude -p` and has a blind judge score them, reporting win rates per condition. See
[`evals/README.md`](evals/README.md).

## The weekly loop

`/accretion:memory-weekly` synthesises digests from sessions, turns stale briefs into
proposals, files contradictions and gaps, archives digest-covered sessions, runs the lints
(`orphan`, `missing-link`, `missing-page`, `stale-reference`, `missing-provenance`), regenerates
the index, writes a run report, commits. It **proposes, never edits brief content**: a wrong brief
edit throws no error, retrieval keeps serving it with unchanged confidence. A human applies
proposals with `accretion apply-proposals --apply`.

```bash
bin/memory-weekly-run.sh work            # dry run: reports, changes nothing
bin/memory-weekly-run.sh work --apply    # writes, commits, pushes if the vault opts in
```

The wrapper runs headless `claude -p` with Bash restricted to `accretion` and `osascript`. To
schedule it, `accretion setup-vault --id work --path <abs> --launchd` writes the plist; see
[`launchd/README.md`](launchd/README.md).

## MCP for clients without a shell

`accretion-mcp` is a stdio server exposing six tools (`search`, `brief`, `context`, `read`,
`list`, `propose`) generated from the same command definitions as the CLI. The plugin registers it
for Claude Code. Elsewhere:

```bash
claude mcp add accretion -- accretion-mcp
```

```toml
# ~/.codex/config.toml
[mcp_servers.accretion]
command = "accretion-mcp"
```

```json
{ "mcpServers": { "accretion": { "command": "accretion-mcp" } } }
```

Clients with a shell are better served by the CLI: the model can filter output before it lands in
context, and a skill costs a description until it fires.

## Project layout

```
src/engine/     the library: vault, retrieval, context, lifecycle, config, eval (public API in index.ts)
src/cli/        the accretion binary; one command spec renders as a subcommand and, when flagged, an MCP tool
src/hooks/      capture and recall hooks, bundled to single files in dist/hooks/
src/mcp/        the stdio adapter
plugin/         Claude Code plugin: manifest, skills, hooks, bin, .mcp.json
scripts/        bootstrap, doctor, setup-vault, memory-eval (wrapped by CLI subcommands)
bin/            launchd wrappers: vault-commit.sh, memory-weekly-run.sh
launchd/        plist templates for the committer and the weekly loop
demo-vault/     example vault documenting this system; the eval fixture
evals/          eval cases and committed scorecards
docs/           DESIGN, REVIEW-RESPONSE, EVAL-PARITY, NEW-PROJECT, ADR-001, research/
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `accretion: command not found` | `node scripts/bootstrap.mjs` links `~/.local/bin/accretion`; put that directory on `PATH`. |
| Code change not visible | `npm run build`; the CLI and the bundled hooks run from `dist/`. |
| Nothing recalled, nothing captured | The directory is unmapped. Add its basename to the project map, or set `_default`. |
| Recall injects nothing on a real question | `accretion recall "<prompt>"` shows the decision. Routing abstains on purpose; add `keywords:` to the brief. |
| `Write to "…" is outside this vault's writable paths` | The engine only writes to `writablePaths`; brief changes go through `propose` and `apply-proposals`. |
| Semantic search slow on first call | Model download (~3 min once, then cached). `--keyword-only` or `DISABLE_EMBEDDINGS=1` to skip. |
| Something misconfigured | `accretion doctor` |

## Development

```bash
npm run dev      # tsc --watch (hooks still need `npm run build` to re-bundle)
npm test         # vitest; the MCP parity test needs a build and skips without one
npm run build    # tsc, then esbuild bundles the hooks
accretion eval --vault demo --no-semantic    # retrieval + routing scorecard against demo-vault
```

Design rationale and the measurement story: [`docs/DESIGN.md`](docs/DESIGN.md),
[`docs/REVIEW-RESPONSE.md`](docs/REVIEW-RESPONSE.md), [`docs/EVAL-PARITY.md`](docs/EVAL-PARITY.md).
The restructure and the sourced research behind it: [`docs/ADR-001-engine-cli-skill.md`](docs/ADR-001-engine-cli-skill.md),
[`docs/research/`](docs/research/).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the things that will bite you and
[`SECURITY.md`](SECURITY.md) for what this software does to your machine.

Maintained by Hidar Elhassan. MIT licensed.
