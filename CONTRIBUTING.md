# Contributing

## Setup

```bash
npm ci
npm run build          # the .mjs scripts import compiled dist/
npm test
```

Node ≥ 20 (22 recommended — see `.nvmrc`).

## Things that will bite you

**The repo is mid-restructure.** Per [`docs/ADR-001-engine-cli-skill.md`](docs/ADR-001-engine-cli-skill.md),
the HTTP MCP server, `src/tools/`, and the `scripts/memory-*.mjs` wrappers are being replaced
by an engine library and the `accretion` CLI, with a six-tool stdio adapter generated from the
same command definitions. Read the ADR before adding code: a new MCP tool or a new script under
`scripts/` is the wrong place for it, and will be deleted in a later phase.

**Scripts import `dist/`, not `src/`.** Anything under `scripts/` loads the compiled build,
so a TypeScript change is invisible to them until you `npm run build`. If a script's
behaviour doesn't match the source you're reading, that's why.

**The MCP server holds code in memory.** New tools and routing changes don't take effect
until you restart the running server process. A change that "didn't work" often just isn't
loaded.

**Three copies of `expandHome` exist, deliberately.** `src/utils/path-safety.ts` for the TS
build, `scripts/lib/expand-home.mjs` for the CLI scripts (which can't import from `dist/`
before it's built), and an inline copy in `hooks/session-journal.mjs` (which is deployed
standalone into `~/.claude/hooks/`, where the rest of the repo doesn't exist). A test
asserts they agree — if you change one, change all three.

**MiniSearch scores are vault-relative.** The routing floor and margin in
`src/vault/brief-routing.ts` are calibrated against the demo vault. A substantially
different corpus may need its own `--sweep-routing` pass; the constants are not universal.

**The capture hook is installed globally.** If you're testing bootstrap, point `CLAUDE_HOME`
at a temp directory or you'll rewrite your own `~/.claude/settings.json`.

## Testing

```bash
npm test                                          # vitest
node scripts/doctor.mjs                           # health check
node scripts/memory-eval.mjs --vault demo --no-semantic   # retrieval + routing
node scripts/memory-eval.mjs --vault demo                 # + semantic (slow first run)
```

The semantic tier downloads a ~90MB model and takes minutes cold, then caches. CI runs
`--no-semantic` only.

For a genuine first-run check, use a throwaway `$HOME` — this is the thing that regressed
before and nothing else catches it:

```bash
FAKE=$(mktemp -d)
HOME=$FAKE CLAUDE_HOME=$FAKE/.claude node scripts/bootstrap.mjs --skip-install
HOME=$FAKE CLAUDE_HOME=$FAKE/.claude node scripts/doctor.mjs   # must exit 0
```

## Evals

`evals/cases.jsonl` is stratified: `direct-name`, `nl`, `terse-acronym`, `off-domain-neg`,
`near-domain-neg`. The negative strata matter as much as the positive ones — routing that
never abstains is worse than routing that sometimes misses, because a confidently wrong
brief poisons the context a caller reasons from.

If you change retrieval or routing, re-run both eval modes and include the deltas in the PR.
Don't tune the fixture to recover a number.

## Conventions

- Comments explain **why**, not what. If a check exists because something broke, say what
  broke — but keep it general, not a dated incident log.
- Never put a real credential in a fixture, including a revoked one. Fixtures outlive the
  secrets they came from. `gitleaks` runs in CI and will stop you.
- New destructive behaviour is opt-in. Dry run first, `--apply` to commit.
