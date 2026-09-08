# Contributing

## Setup

```bash
npm ci
npm run build          # tsc, then esbuild bundles the hooks into dist/hooks/
npm test
```

Node ≥ 20 (22 recommended, see `.nvmrc`). Read
[`docs/ADR-001-engine-cli-skill.md`](docs/ADR-001-engine-cli-skill.md) before adding code: it
says what the engine is allowed to do, what the CLI owns, and what is deliberately deferred.

## Where things go

- **`src/engine/`** is the library. It has no I/O policy: no git, no stdout logging, no
  environment reads outside `config/`. If a change needs any of those, it belongs in a caller.
- **`src/cli/commands/`** holds command specs. A spec is a zod input schema plus `run` and
  `format`. The flag parser, `--help`, and the MCP tool definition are all derived from the
  schema, so a new flag is one line and never a second hardcoded list. Flag a spec `mcp: true`
  only if a client without a shell needs it; the set is deliberately small.
- **`src/hooks/`** are bundled to single files. They import engine modules directly and must
  stay fast: the recall hook answers inside a 10 s timeout on every prompt, the capture hook
  shares a short budget with every other SessionEnd hook.
- **`plugin/`** is the Claude Code packaging. Skills there are the model-facing prose; keep
  them short, positive, and free of anything the agent can read from `--help`.

## Things that will bite you

**The CLI and hooks run from `dist/`.** A TypeScript change is invisible until `npm run build`.
If behaviour does not match the source you are reading, that is why.

**Writes are gated.** `VaultManager` refuses writes outside the vault's `writablePaths`
(sessions, proposals, the log and the index by default). `applyProposal` is the one caller that
passes `unrestricted`. If a new feature needs to touch a curated note, it should produce a
proposal, not an edit.

**Nothing in the engine runs git.** `accretion commit` does, and it unstages the derived
`.mcp/` files. Do not add commits to write paths; the capture hook once did, and concurrent
writes raced on the index lock.

**The tokenizer stop list is shared.** `tokenize` in `brief-routing.ts` serves both the routing
domain trigger and recall's vocabulary gate. Adding a word affects both; re-run the eval.

**MiniSearch scores are vault-relative.** The routing floor and margin are calibrated against the
demo vault. A substantially different corpus may need its own `--sweep-routing` pass.

**Symlinked vault paths.** `VaultManager` resolves its root through `realpath`, because
path-safety compares real paths and a symlinked root once indexed nothing, silently. Tests that
create vaults under `os.tmpdir()` must `realpath` it too (macOS `/var` is a symlink).

**The hooks are global.** If you are testing bootstrap, point `CLAUDE_HOME` at a temp directory
or you will rewrite your own `~/.claude/settings.json` and skills.

## Testing

```bash
npm test                                          # vitest
accretion doctor                                  # health check
accretion eval --vault demo --no-semantic         # retrieval + routing, fast
accretion eval --vault demo                       # + semantic (slow first run)
```

The MCP parity test spawns the real stdio server and compares tool output to `accretion
<cmd> --json`; it skips when `dist/` is absent. CI runs the no-semantic eval against
`.github/ci-vaults.json`, which points at `demo-vault/` by a relative path.

For a genuine first-run check, use a throwaway home. This is what regressed before and nothing
else catches it:

```bash
FAKE=$(mktemp -d)
HOME=$FAKE CLAUDE_HOME=$FAKE/.claude node scripts/bootstrap.mjs --skip-install
HOME=$FAKE CLAUDE_HOME=$FAKE/.claude node scripts/doctor.mjs   # must exit 0
```

## Evals

`evals/cases.jsonl` is stratified: `direct-name`, `nl`, `terse-acronym`, `off-domain-neg`,
`near-domain-neg`. The negative strata matter as much as the positive ones: routing that never
abstains is worse than routing that sometimes misses, because a confidently wrong brief poisons
the context a caller reasons from.

If you change retrieval, routing, the stop list, or chunking, re-run both eval modes and include
the deltas in the PR. Do not tune the fixture to recover a number.

## Conventions

- Comments explain **why**, not what. If a check exists because something broke, say what
  broke, but keep it general, not a dated incident log.
- Never put a real credential in a fixture, including a revoked one. Fixtures outlive the
  secrets they came from. `gitleaks` runs in CI and will stop you.
- New destructive behaviour is opt-in. Dry run first, `--apply` to commit.
- Skill prose states the target behaviour, not the forbidden one, and says nothing the model
  already does by default.
