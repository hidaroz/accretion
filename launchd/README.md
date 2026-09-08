# Scheduled pieces (launchd)

Two macOS launch agents. Both derive the checkout from the wrapper's own location, prepend the
usual bin directories to `PATH` (launchd hands processes a minimal one), and log under
`~/Library/Logs/`.

## The committer: `accretion commit` every 20 minutes

The only git writer for the vaults. `bin/vault-commit.sh` runs `accretion commit`, which stages
each registered vault with `gitAutoCommit` enabled, skips a vault with a live `index.lock` or
nothing to commit, commits `vault-sync: <timestamp>`, pushes only when `gitAutoPush` is true,
and unstages the derived `.mcp/` files. The capture hook calls the same command for its own
note, so a session is committed within seconds and everything else within the interval.

```bash
node scripts/bootstrap.mjs --committer     # writes ~/Library/LaunchAgents/com.accretion.committer.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.accretion.committer.plist
```

Template: `vault-committer.plist.template` (`RunAtLoad` true, `StartInterval` 1200).

## The weekly loop: `/accretion:memory-weekly` on Monday at 09:00

`bin/memory-weekly-run.sh <vault> [--apply]` runs a headless
`claude -p "/accretion:memory-weekly --autonomous --vault <id> [--dry-run]"` with
`--permission-prompts none` and Bash restricted to `accretion` and `osascript`. The run
synthesises digests, **proposes** brief updates, files contradictions and gaps, archives
digest-covered sessions, runs the lints, regenerates the index, writes a run report, commits
through `accretion commit`, and notifies.

It never edits brief content. Proposals land in `proposals/brief-updates/` and a human applies
them with `accretion apply-proposals --apply`. Deterministic housekeeping (digests,
`last_reviewed` stamps, archive, index) stays automatic.

**Dry run is the default.** The plist must carry `--apply` for the scheduled run to write.

### One-time setup

1. Generate the plist:
   ```bash
   accretion setup-vault --id work --path ~/Documents/work-vault --launchd
   ```
2. Supervised first run, before trusting the schedule:
   ```bash
   bin/memory-weekly-run.sh work
   tail -f ~/Library/Logs/memory-weekly/work/$(date +%Y-%m-%d).log
   ```
   Confirm it reported digests and proposals and said nothing was written. Then
   `bin/memory-weekly-run.sh work --apply` and confirm `sessions/digests/_runs/{today}-memory-run.md`
   exists and the vault committed.
3. Install and load, adding `--apply` to the plist's `ProgramArguments`:
   ```bash
   cp launchd/com.memory-weekly.work.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.memory-weekly.work.plist
   ```
4. Trigger a scheduled-path run on demand, which is the step that catches a plist that was
   generated but never loaded:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.memory-weekly.work
   ```

The wrapper passes `--plugin-dir <checkout>/plugin` only when the plugin is not already
installed under `~/.claude/skills/accretion`; two copies would collide on skill names.

## Manage

- Status: `launchctl print gui/$(id -u)/com.memory-weekly.work`
- Logs: `~/Library/Logs/memory-weekly/work/` (per-day `claude` log plus launchd out/err),
  `~/Library/Logs/accretion/vault-committer.*.log`
- Unload: `launchctl bootout gui/$(id -u)/com.memory-weekly.work`

## Notes

- launchd runs a missed job on the next wake, so a sleeping Mac delays a run rather than
  skipping it.
- Both agents need you logged in (GUI launch agents). The weekly loop needs the `claude` CLI
  authenticated. Everything runs locally.
- **The failure mode to watch for is silence.** This pipeline has died quietly before: a hook
  that vanished, an agent generated but never loaded. `accretion doctor` checks that both agents
  are loaded, that a run report exists from the last 10 days, that no digests are backlogged,
  and that the embedding index is not stale. Run it if the vault ever feels out of date.
- Elsewhere than macOS, schedule `bin/vault-commit.sh` and `bin/memory-weekly-run.sh <id>
  --apply` with cron.
