# accretion

A curated, human-readable **memory for AI agents**, served over [MCP](https://modelcontextprotocol.io).
It indexes one or more Obsidian markdown vaults and exposes hybrid retrieval (keyword + local
semantic, fused with reciprocal-rank fusion), confidence-gated **brief routing**, and a self-running
weekly maintenance loop — so your agents recall durable project knowledge instead of re-deriving it.

The thesis: memory should compound and stay *legible* (markdown + git), not accumulate as opaque
vectors. Design rationale and the measurement story live in [`docs/DESIGN.md`](docs/DESIGN.md) and
[`docs/REVIEW-RESPONSE.md`](docs/REVIEW-RESPONSE.md).

## Direction

accretion is being restructured. The product is an **engine** (a pure library) and an
**`accretion` CLI** over it. Agents reach it through the CLI, a Claude Code **skill** that
teaches when to call it, and two **hooks**: session capture and prompt-time passive recall. All
of that ships as a Claude Code **plugin** with the CLI on `PATH`. A thin **stdio MCP adapter**
with six tools, generated from the same command definitions as the CLI, remains for clients
that have no shell. The HTTP server documented below is being retired on this branch; the
lifecycle scripts under `scripts/` become CLI subcommands. The decision, its evidence, and the
follow-ups are in [`docs/ADR-001-engine-cli-skill.md`](docs/ADR-001-engine-cli-skill.md).

> **Transport note:** this is a long-running **HTTP** MCP server (Streamable HTTP) with Bearer-token
> auth, not a stdio server. You start it once and point your client at `http://127.0.0.1:3001/mcp`.

---

## Prerequisites

- **Node ≥ 20** (22 recommended — see [`.nvmrc`](.nvmrc))
- **git**
- macOS or Linux (the optional auto-start uses macOS `launchd`)

## Install

```bash
git clone https://github.com/hidaroz/accretion.git
cd accretion
npm install
npm run build
```

On a brand-new machine, you can instead run the one-shot bootstrap (installs + builds, wires the
session-capture hook into Claude Code) — see [Fresh machine](#fresh-machine).

## Configure

**1. Secrets** — copy the example env and set an API key:

```bash
cp .env.example .env
# edit .env: set API_KEY (e.g. `openssl rand -hex 32`)
```

| Var | Default | Purpose |
|---|---|---|
| `API_KEY` | *(required)* | Bearer token every `/mcp` request must send |
| `VAULTS_CONFIG` | *(required)* | Path to the multi-vault registry. `setup-vault` writes `~/.config/accretion/vaults.json`; the server does **not** assume it — point `.env` at the file. A leading `~` is expanded. |
| `VAULT_PATH` | — | Legacy single-vault mode (used only if `VAULTS_CONFIG` is unset) |
| `HOST` | `127.0.0.1` | Bind address (localhost-only by default; `0.0.0.0` to expose) |
| `PORT` | `3001` | Listen port |
| `DISABLE_EMBEDDINGS` | — | Set to `1` to skip the semantic model (keyword + routing only) |
| `TRANSFORMERS_CACHE` | OS cache dir | Where the embedding model weights are cached |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Override the sentence-embedding model |
| `LOG_LEVEL` | `info` | `error` silences the info-level startup lines |

**2. Register a vault** — this creates the vault skeleton and the registry entry:

```bash
node scripts/setup-vault.mjs --id work --path ~/Documents/work-vault --display "Work" --default
# or, after `npm link`:  accretion-setup-vault --id work --path <abs> --default
```

See [`docs/NEW-PROJECT.md`](docs/NEW-PROJECT.md) for multi-project routing, git, and scheduling flags.

## Run

```bash
npm start            # node dist/index.js
```

- Health: `curl http://127.0.0.1:3001/health` (and `/health/ready` once vaults are indexed).
- **Restart to reload:** the running process holds compiled code in memory — after `npm run build`,
  restart the server for changes to take effect.
- First semantic search downloads the embedding model (~3 min once, then cached). Keyword search and
  routing work immediately.

To run the server automatically at login (macOS), see [Auto-start](#auto-start-macos).

## Register with your MCP client

The server is HTTP with `Authorization: Bearer $API_KEY`. Point your client at
`http://127.0.0.1:3001/mcp`. Replace the token with your `API_KEY` (or reference an env var).

### Claude Code

CLI:

```bash
claude mcp add --transport http obsidian http://127.0.0.1:3001/mcp \
  --header "Authorization: Bearer ${API_KEY}"
```

…or in `.mcp.json` (project) / `~/.claude.json` (global):

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "http://127.0.0.1:3001/mcp",
      "headers": { "Authorization": "Bearer ${API_KEY}" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "obsidian": {
      "url": "http://127.0.0.1:3001/mcp",
      "headers": { "Authorization": "Bearer ${env:API_KEY}" }
    }
  }
}
```

### Codex

`~/.codex/config.toml` — Codex reads the token from the named env var (export `API_KEY` in its
environment):

```toml
[mcp_servers.obsidian]
url = "http://127.0.0.1:3001/mcp"
bearer_token_env_var = "API_KEY"
```

## Fresh machine

One command wires the per-machine pieces: build, the SessionEnd capture hook, the
`/memory-weekly` command, and the `~/.claude/settings.json` entry. It's idempotent and backs
up anything it overwrites.

> ### What the capture hook records — read this before running bootstrap
>
> The hook is installed **globally**, into `~/.claude/settings.json`. It has to be, or it
> would never fire. That means it runs at the end of **every** Claude Code session, in every
> project you open.
>
> For a project you have mapped to a vault, it writes a note containing the session's
> **topics, the files you changed, and the shell commands you ran**, then `git commit`s it.
>
> **Capture is opt-in.** `_default: null` in `~/.claude/hooks/project-vault-map.json` means
> unmapped projects record *nothing*. Add a mapping (or run `setup-vault --project <slug>`)
> to turn capture on for a project. Setting `_default` to a vault id captures everything —
> that's a deliberate choice, not the default.
>
> Credentials are stripped before anything is written (vendor tokens, JWTs, URL-embedded
> passwords, `FOO_SECRET=` assignments). It is deliberately blunt and it is **not a
> guarantee** — assume a vault contains whatever you pasted into a session.
>
> `gitAutoPush` defaults to **false**. Nothing leaves your machine unless you enable it.

```bash
node scripts/bootstrap.mjs            # add --server-autostart to also install the launchd agent
```

Then register a vault (`setup-vault`), set `.env`, start the server, register your client, and
verify:

```bash
node scripts/doctor.mjs               # read-only health check (Node, vaults, hook, server)
```

`bootstrap`/`doctor` honor a `CLAUDE_HOME` env override (default `~/.claude`).

## Auto-start (macOS)

`node scripts/bootstrap.mjs --server-autostart` generates a `launchd` agent from
[`launchd/mcp-server.plist.template`](launchd/mcp-server.plist.template) (wrapper:
[`bin/mcp-server-run.sh`](bin/mcp-server-run.sh)) and prints the `launchctl load` command. The
weekly memory-maintenance job has its own agent — see [`launchd/`](launchd/).

## Project layout

```
src/            MCP server (tools, vault indexing, hybrid retrieval, brief routing)
scripts/        CLI: setup-vault, bootstrap, doctor, memory-* maintenance, memory-eval (the eval harness)
bin/            launchd wrappers (server, weekly maintenance run)
hooks/          session-journal capture hook (copied into ~/.claude/hooks/)
commands/       /memory-weekly slash command (copied into ~/.claude/commands/)
launchd/        launchd templates (server + weekly maintenance)
demo-vault/     example vault documenting this system; the eval fixture
evals/          eval cases + scorecards (evals/results/)
docs/           DESIGN, NEW-PROJECT, REVIEW-RESPONSE
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| New tool / routing change not visible | Restart the server (it holds old code in memory) |
| `API_KEY environment variable is required` | Set `API_KEY` in `.env` |
| Semantic search slow on first call | Model download (~3 min); cached after. Or set `DISABLE_EMBEDDINGS=1` |
| Client can't connect | Check the server is running (`curl …/health`), the URL ends in `/mcp`, and the Bearer token matches `API_KEY` |
| Something misconfigured | `node scripts/doctor.mjs` |

## Development

```bash
npm run dev      # tsx watch (no rebuild needed)
npm test         # vitest
npm run build    # tsc → dist/
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the things that will bite you, and
[`SECURITY.md`](SECURITY.md) for what this software does to your machine.

Maintained by Hidar Elhassan. MIT licensed.
