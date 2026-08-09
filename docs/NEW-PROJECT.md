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
- Registers the vault in `~/.config/accretion/vaults.json` (**gitAutoCommit: true, gitAutoPush: false** by default — add `--push` only once a sanctioned remote is set).
- Routes the project slug(s) → this vault in `~/.claude/hooks/project-vault-map.json`. The slug is the **working directory's basename**, so working in `~/work/acme-foo` writes sessions to the `acme` vault.
- `--git`: `git init` + initial commit (never pushes).
- `--launchd`: generates `launchd/com.memory-weekly.<id>.plist` and prints the install command for the weekly autonomous run.

## Verify

1. Work in a directory matching a routed slug; end the session → a note appears at `<vault>/sessions/<YYYY>/<MM-DD>/<slug>-<hash>.md`.
2. Supervised first autonomous run: `bin/memory-weekly-run.sh <id>` (watch `~/Library/Logs/memory-weekly/<id>/`).
3. Schedule it: `cp launchd/com.memory-weekly.<id>.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.memory-weekly.<id>.plist`.

## Client work and IP-sensitive contexts

If the vault holds someone else's intellectual property, a few defaults are worth revisiting.

- **Keep `--push` off** until the remote is the client's or employer's repo rather than a
  personal one. Then enable it per vault in `vaults.json`. Pushing a vault to the wrong
  remote is not an undoable mistake.
- **Route the model through their credentials**, not yours — a direct API key, Bedrock
  (`CLAUDE_CODE_USE_BEDROCK=1` plus AWS creds), or a gateway base URL. The launchd wrapper
  inherits its environment, so set these somewhere it can see them.
- **Local embeddings** download a model from HuggingFace on first use. On a locked-down
  network, pre-seed the cache (`TRANSFORMERS_CACHE`, or `EMBEDDING_MODEL` pointing at a
  vendored path) or run with `DISABLE_EMBEDDINGS=1` until that is sorted.
- **Encryption at rest is a separate decision.** A private repo plus the org's access
  controls is often sufficient; git-crypt is available if not. Don't carry a personal
  vault's setup across without asking whether it fits.

## Fresh-machine setup

On a brand-new machine, run the bootstrap once — it builds, installs the capture hook, and wires
the `SessionEnd` hook into `~/.claude/settings.json` (idempotent, backs up settings first):

```bash
git clone https://github.com/hidaroz/accretion.git && cd accretion
node scripts/bootstrap.mjs            # add --server-autostart to install the launchd agent (macOS)
```

Then onboard your first project and verify:

```bash
node scripts/setup-vault.mjs --id <name> --path <abs-path> --default   # creates vaults.json
cp .env.example .env                                                    # set API_KEY
node scripts/doctor.mjs                                                 # health check
```

The hook resolves `vaults.json` via `$VAULTS_CONFIG` or `~/.config/accretion/vaults.json`, the
repo path via `$ACCRETION_HOME`, and the project map via `$PROJECT_VAULT_MAP` — nothing is
hardcoded to a user or machine. `bootstrap`/`doctor` also honor `$CLAUDE_HOME` (default `~/.claude`).
See the root [`README.md`](../README.md) for running the server and registering MCP clients.
