#!/usr/bin/env bash
#
# Weekly memory curation. Invoked by launchd (com.memory-weekly.<vault>) or by
# hand for a supervised run.
#
# Usage:
#   bin/memory-weekly-run.sh <vault-id>            # dry run — reports, changes nothing
#   bin/memory-weekly-run.sh <vault-id> --apply    # actually writes to the vault
#
# Dry run is the default deliberately. This spawns a headless agent with write
# access to a vault and the ability to commit and push it. That is a reasonable
# thing to schedule once you have watched it work and read a run report; it is
# not a reasonable thing to happen to somebody the first time they try the tool.
# Pass --apply once you trust it, and set it in the launchd plist's arguments.
#
set -uo pipefail

VAULT="${1:-}"
if [ -z "$VAULT" ]; then
  echo "usage: memory-weekly-run.sh <vault-id> [--apply]" >&2
  exit 2
fi

APPLY=0
for arg in "${@:2}"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Derive the repo from this script's own location — no hardcoded machine path.
SERVER_REPO="$(cd "$(dirname "$0")/.." && pwd)"
export ACCRETION_HOME="$SERVER_REPO"

# Logs follow the platform convention rather than assuming macOS. The launchd
# path is macOS-only, but this script is also run by hand on Linux, where
# ~/Library/Logs is just a confusing directory that should not exist.
if [ "$(uname -s)" = "Darwin" ]; then
  LOG_DIR="$HOME/Library/Logs/memory-weekly/$VAULT"
else
  LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/accretion/memory-weekly/$VAULT"
fi
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d).log"

# launchd hands processes a minimal PATH, so node/claude/git must be findable.
# Only prepend directories that exist: hardcoding Homebrew's prefix breaks the
# lookup for anyone whose node comes from nvm, fnm, asdf or Volta, since a
# stale early hit shadows the one on the caller's real PATH.
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.npm-global/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH

# Desktop notifications are macOS-only; elsewhere the log is the record.
notify() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  osascript -e "display notification \"$1\" with title \"$2\"" >/dev/null 2>&1 || true
}
notify_fail() { notify "run failed — see $LOG" "memory-weekly FAILED ($VAULT)"; }

{
  MODE="dry-run"; [ "$APPLY" -eq 1 ] && MODE="apply"
  echo "=== memory-weekly run $(date -u +%Y-%m-%dT%H:%M:%SZ) vault=$VAULT mode=$MODE ==="

  # The memory-*.mjs scripts import compiled dist/. Build if missing.
  if [ ! -d "$SERVER_REPO/dist" ]; then
    echo "dist/ missing — building…"
    ( cd "$SERVER_REPO" && npm run build ) || { echo "BUILD FAILED"; notify_fail; exit 1; }
  fi

  # Headless run with a constrained allowlist (NOT --dangerously-skip-permissions).
  # The skill needs: node (the memory-*.mjs scripts), git (commit/push),
  # osascript (the notification), and file Read/Write/Edit for digests/proposals.
  #
  # Note that Bash(node:*) permits `node -e '…'`, so this allowlist is closer to
  # arbitrary code execution than it looks. It is bounded by the skill's own
  # instructions, not by the allowlist — which is the reason dry run is default.
  SKILL_ARGS="--autonomous --vault $VAULT"
  [ "$APPLY" -eq 1 ] || SKILL_ARGS="$SKILL_ARGS --dry-run"

  claude -p "/memory-weekly $SKILL_ARGS" \
    --permission-mode acceptEdits \
    --allowedTools "Bash(node:*)" "Bash(git:*)" "Bash(osascript:*)" "Read" "Write" "Edit"
  status=$?

  if [ "$status" -ne 0 ]; then
    echo "=== claude exited $status — FAILED ==="
    notify_fail
    exit "$status"
  fi

  if [ "$APPLY" -eq 0 ]; then
    echo "=== dry run complete — nothing written. Re-run with --apply to commit. ==="
    exit 0
  fi

  # Postflight. A run that exits 0 having quietly done nothing is the failure
  # mode this pipeline actually has, and it can go unnoticed for weeks. doctor
  # knows what "still broken" looks like (backlog, stale index, unloaded agent),
  # so let it, not the exit code, decide whether this run counts as healthy.
  echo "--- doctor (postflight) ---"
  if node "$SERVER_REPO/scripts/doctor.mjs"; then
    echo "=== done $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  else
    echo "=== run completed but doctor reports failures — see above ==="
    notify "run finished, but doctor still reports failures — see $LOG" \
           "memory-weekly needs attention ($VAULT)"
  fi
} >>"$LOG" 2>&1
