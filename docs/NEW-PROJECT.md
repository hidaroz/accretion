# Onboarding a new project / vault

The memory system is project-agnostic: each project gets its own vault, and
sessions auto-route to the right one. Adding a project is one command.

## One command

```bash
node scripts/setup-vault.mjs \
  --id acme \
  --path ~/work/acme-vault \
  --display "Acme" \
  --project acme-foo,acme-bar \
  --git --launchd
```

What it does (idempotent — safe to re-run):
- Creates the standard vault skeleton (`sessions/`, `proposals/brief-updates/`, `MOCs/`, `Knowledge/`, `00-Index/`, `.mcp/`) + seeds `Home.md`, `.mcp/brief-map.json`, `.gitignore`.
- Registers the vault in `~/.config/obsidian-mcp/vaults.json` (**gitAutoCommit: true, gitAutoPush: false** by default — add `--push` only once a sanctioned remote is set).
- Routes the project slug(s) → this vault in `~/.claude/hooks/project-vault-map.json`. The slug is the **working directory's basename**, so working in `~/work/acme-foo` writes sessions to the `acme` vault.
- `--git`: `git init` + initial commit (never pushes).
- `--launchd`: generates `infra/launchd/com.memory-weekly.<id>.plist` and prints the install command for the weekly autonomous run.

## Verify

1. Work in a directory matching a routed slug; end the session → a note appears at `<vault>/sessions/<date>/<slug>-<hash>.md`.
2. Supervised first autonomous run: `bin/memory-weekly-run.sh <id>` (watch `~/Library/Logs/memory-weekly/<id>/`).
3. Schedule it: `cp infra/launchd/com.memory-weekly.<id>.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.memory-weekly.<id>.plist`.

## Acme / IP-sensitive contexts

- **Keep `--push` off** until the remote is the **org** GitHub repo (not personal). Then enable per vault in `vaults.json`.
- **Anthropic via the org's tokens/endpoint.** Point Claude Code at their credentials (direct API key, or Bedrock via `CLAUDE_CODE_USE_BEDROCK=1` + AWS creds, or a gateway base URL). The launchd wrapper inherits the environment, so set these where it can see them.
- **Local embeddings** download a model from HuggingFace on first use. On a locked-down network, pre-seed it (`TRANSFORMERS_CACHE` / `EMBEDDING_MODEL` → a vendored path) or run with `DISABLE_EMBEDDINGS=1` until sorted.
- **git-crypt is optional** — a private org repo + their access controls is usually enough; don't carry over personal-vault encryption blindly.

## Fresh-machine setup (manual, until scripted)

`setup-vault` handles per-project onboarding. On a brand-new machine you also need, once:
1. Clone this repo, `npm install`, `npm run build`.
2. Copy the capture hook: `cp hooks/session-journal.mjs ~/.claude/hooks/` (and `project-vault-map.json.example` → `~/.claude/hooks/project-vault-map.json` if absent).
3. Add a `SessionEnd` hook in `~/.claude/settings.json` running `node ~/.claude/hooks/session-journal.mjs`.
4. Run `setup-vault` for your first project (it creates `vaults.json`).

The hook resolves `vaults.json` via `$VAULTS_CONFIG` or `~/.config/obsidian-mcp/vaults.json`, and the repo path via `$OBSIDIAN_MCP_HOME` — nothing is hardcoded to a user or machine.
