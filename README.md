# obsidian-mcp-server

A curated, human-readable **memory for AI agents**, served over [MCP](https://modelcontextprotocol.io).
It indexes one or more Obsidian markdown vaults and exposes hybrid retrieval (keyword + local
semantic, fused with reciprocal-rank fusion), confidence-gated **brief routing**, and a self-running
weekly maintenance loop — so your agents recall durable project knowledge instead of re-deriving it.

The thesis: memory should compound and stay *legible* (markdown + git), not accumulate as opaque
vectors. Design rationale and the measurement story live in [`docs/DESIGN.md`](docs/DESIGN.md) and
[`docs/REVIEW-RESPONSE.md`](docs/REVIEW-RESPONSE.md).

> **Transport note:** this is a long-running **HTTP** MCP server (Streamable HTTP) with Bearer-token
> auth, not a stdio server. You start it once and point your client at `http://127.0.0.1:3001/mcp`.

---

## Prerequisites

- **Node ≥ 20** (22 recommended — see [`.nvmrc`](.nvmrc))
- **git**
- macOS or Linux (the optional auto-start uses macOS `launchd`)

## Install

```bash
git clone https://github.com/hidaroz/obsidian-mcp-server.git
cd obsidian-mcp-server
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
| `VAULTS_CONFIG` | `~/.config/obsidian-mcp/vaults.json` | Path to the multi-vault registry |
| `VAULT_PATH` | — | Legacy single-vault mode (used only if `VAULTS_CONFIG` is unset) |
| `HOST` | `127.0.0.1` | Bind address (localhost-only by default; `0.0.0.0` to expose) |
| `PORT` | `3001` | Listen port |
| `DISABLE_EMBEDDINGS` | — | Set to `1` to skip the semantic model (keyword + routing only) |
| `TRANSFORMERS_CACHE` | OS cache dir | Where the embedding model weights are cached |

**2. Register a vault** — this creates the vault skeleton and the registry entry:

```bash
node scripts/setup-vault.mjs --id work --path ~/devprojects/work/work-vault --display "Work" --default
# or, after `npm link`:  omcp-setup-vault --id work --path <abs> --default
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

One command wires the per-machine pieces (build, the SessionEnd capture hook, and the
`~/.claude/settings.json` entry). It's idempotent and backs up `settings.json` before editing:

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
[`infra/launchd/mcp-server.plist.template`](infra/launchd/mcp-server.plist.template) (wrapper:
[`bin/mcp-server-run.sh`](bin/mcp-server-run.sh)) and prints the `launchctl load` command. The
weekly memory-maintenance job has its own agent — see [`infra/launchd/`](infra/launchd/).

## Project layout

```
src/            MCP server (tools, vault indexing, hybrid retrieval, brief routing)
scripts/        CLI: setup-vault, bootstrap, doctor, memory-* maintenance, memory-eval (the eval harness)
hooks/          session-journal capture hook (copied into ~/.claude/hooks/)
infra/launchd/  launchd templates (server + weekly maintenance)
evals/          eval cases + scorecards (see docs/2026-06-28-eval-parity-split.md)
docs/           DESIGN, NEW-PROJECT, REVIEW-RESPONSE, HANDOFF
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

Maintained by Hidar Elhassan. Private repository.
