# Onboarding a new project / vault

accretion is project-agnostic: each project gets a vault, and sessions and recall route to it by
the working directory's basename. Adding a project is one command.

## One command

```bash
accretion setup-vault \
  --id acme \
  --path ~/work/acme-vault \
  --display "Acme" \
  --project acme-foo,acme-bar \
  --git --launchd
```

What it does (idempotent, safe to re-run):

- Creates the vault skeleton (`sessions/`, `proposals/brief-updates/`, `MOCs/`, `Knowledge/`,
  `00-Index/`, `.mcp/`) and seeds `Home.md`, `.mcp/brief-map.json`, and a `.gitignore` that
  lists the derived `.mcp/` files.
- Registers the vault in `~/.config/accretion/vaults.json` with `gitAutoCommit: true` and
  `gitAutoPush: false`. Add `--push` only once a sanctioned remote is set.
- Routes the project slug(s) to this vault in the project map. The slug is the **working
  directory's basename**, so working in `~/work/acme-foo` captures to and recalls from `acme`.
- `--git`: `git init` plus an initial commit (never pushes; refuses to sweep an existing dirty
  repo into that commit).
- `--launchd`: generates `launchd/com.memory-weekly.<id>.plist` and prints the install command
  for the weekly loop.

## Verify

1. Work in a directory matching a routed slug. Ask a question that a brief should answer:
   `accretion recall "<the question>"` shows what the hook will inject. End the session: a note
   appears at `<vault>/sessions/<YYYY>/<MM-DD>/<slug>-<id8>.md` and one line lands in
   `00-Index/log.md`.
2. Supervised first weekly run: `bin/memory-weekly-run.sh <id>` (dry run) and read
   `~/Library/Logs/memory-weekly/<id>/`.
3. Schedule it: `cp launchd/com.memory-weekly.<id>.plist ~/Library/LaunchAgents/ && launchctl
   bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.memory-weekly.<id>.plist`, with `--apply`
   in the plist's arguments once you trust it.
4. `accretion doctor` should be clean.

## Making the vault routable

Routing reads keywords from the notes themselves. A brief declares them in frontmatter:

```yaml
---
title: Coffee roasting
tags:
  - type/brief
keywords:
  - coffee
  - beans
  - roast
---
```

`.mcp/brief-map.json` (`{"keyword": "path/to/brief.md"}`) overrides a note's claim when a word
should route somewhere else. `type/playbook` and `type/rejected` notes route the same way.
`accretion brief <keyword>` shows the result; an abstention means nothing claimed the word.


## Saying when a note is current

Curated notes can carry validity in frontmatter, and everything that places a note in front
of a model (passive recall, `accretion brief`, `accretion context`) renders it as one line
under the title:

```yaml
last_reviewed: 2026-07-21     # stamped by the weekly loop or by you after a review
review_by: 2026-10-21         # when it is due again; past this date the line says "overdue"
valid_from: 2026-01-01        # optional: when the described behaviour began
superseded_by: brief-routing-v2   # optional: a newer note replaces this one
```

`accretion garden` lists notes under the `stale` rule when `review_by` has passed, when
`superseded_by` is set, or when a brief's `last_reviewed` is older than 90 days
(`--stale-days` to change). Notes without these keys render nothing and are never flagged
by the first two checks, so the convention is opt-in per note; the sibling-is-the-schema
rule spreads it once one brief carries it.

## Client work and IP-sensitive contexts

If the vault holds someone else's intellectual property, a few defaults are worth revisiting.

- **Keep `--push` off** until the remote is the client's or employer's repo rather than a
  personal one. Then enable it per vault in `vaults.json`. Pushing a vault to the wrong remote
  is not an undoable mistake.
- **Set `recall.mode: off`** for a vault whose content you do not want placed in front of the
  model without you asking, or `brief-only` to limit injection to curated briefs.
- **Route the weekly loop's model through their credentials**, not yours: a direct API key,
  Bedrock (`CLAUDE_CODE_USE_BEDROCK=1` plus AWS creds), or a gateway base URL. The launchd
  wrapper inherits its environment, so set these somewhere it can see them.
- **Local embeddings** download a model from Hugging Face on first use. On a locked-down
  network, pre-seed the cache (`TRANSFORMERS_CACHE`, or `EMBEDDING_MODEL` pointing at a vendored
  path) or set `semantic: false` for the vault.
- **Encryption at rest is a separate decision.** A private repo plus the org's access controls
  is often sufficient; git-crypt works if not. `accretion commit` runs plain git, so git-crypt's
  filters apply as long as `git-crypt` is on the committer's `PATH` (the wrapper prepends the
  usual Homebrew and local bin directories).

## Fresh-machine setup

```bash
git clone https://github.com/hidaroz/accretion.git && cd accretion
npm install && npm run build
node scripts/bootstrap.mjs            # plugin install, CLI on PATH, registry migration
accretion setup-vault --id <name> --path <abs-path> --default
accretion doctor
```

The hooks resolve the registry via `$VAULTS_CONFIG` or `~/.config/accretion/vaults.json`, the
project map via `$PROJECT_VAULT_MAP` or `~/.claude/hooks/project-vault-map.json`, and the
checkout via `$ACCRETION_HOME` or their own location. Nothing is hardcoded to a user or machine.
See the root [`README.md`](../README.md) for using the CLI and the skill.
