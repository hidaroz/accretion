# accretion plugin

The Claude Code packaging of accretion: the `accretion` CLI on PATH (`bin/`), two skills
(`/accretion:memory` teaches when to reach for the vault, `/accretion:memory-weekly` runs
curation), two hooks (session capture on `SessionEnd`, passive recall on
`UserPromptSubmit`), and a stdio MCP adapter for clients without a shell.

This directory lives inside the accretion checkout and points at `../dist`, so build first.

Try it for one session: `claude --plugin-dir /path/to/accretion/plugin`.
Keep it: `node scripts/bootstrap.mjs` symlinks it into `~/.claude/skills/accretion`, where
Claude Code loads it as a plugin on every session (see `docs/ADR-001-engine-cli-skill.md`).
