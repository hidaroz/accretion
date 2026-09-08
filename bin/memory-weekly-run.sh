#!/usr/bin/env bash
#
# Weekly memory curation. Invoked by launchd (com.memory-weekly.<vault>) or by
# hand for a supervised run.
#
# Usage:
#   bin/memory-weekly-run.sh <vault-id>            # dry run: reports, changes nothing
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

# Derive the repo from this script's own location; no hardcoded machine path.
SERVER_REPO="$(cd "$(dirname "$0")/.." && pwd)"
export ACCRETION_HOME="$SERVER_REPO"

if [ "$(uname -s)" = "Darwin" ]; then
  LOG_DIR="$HOME/Library/Logs/memory-weekly/$VAULT"
else
  LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/accretion/memory-weekly/$VAULT"
fi
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d).log"

# launchd hands processes a minimal PATH; only prepend directories that exist.
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.npm-global/bin" "$SERVER_REPO/plugin/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH

notify() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  osascript -e "display notification \"$1\" with title \"$2\"" >/dev/null 2>&1 || true
}
notify_fail() { notify "run failed; see $LOG" "memory-weekly FAILED ($VAULT)"; }

{
  MODE="dry-run"; [ "$APPLY" -eq 1 ] && MODE="apply"
  echo "=== memory-weekly run $(date -u +%Y-%m-%dT%H:%M:%SZ) vault=$VAULT mode=$MODE ==="

  if [ ! -f "$SERVER_REPO/dist/cli/main.js" ]; then
    echo "dist/ missing; building…"
    ( cd "$SERVER_REPO" && npm run build ) || { echo "BUILD FAILED"; notify_fail; exit 1; }
  fi

  # Load the plugin for this run unless it is already installed persistently
  # (a second copy would collide on skill names).
  PLUGIN_ARGS=()
  if [ ! -f "$HOME/.claude/skills/accretion/.claude-plugin/plugin.json" ]; then
    PLUGIN_ARGS=(--plugin-dir "$SERVER_REPO/plugin")
  fi

  SKILL_ARGS="--autonomous --vault $VAULT"
  [ "$APPLY" -eq 1 ] || SKILL_ARGS="$SKILL_ARGS --dry-run"

  # The allowlist is the CLI and the notifier. The skill never runs git itself:
  # `accretion commit` does, reading push policy from vaults.json.
  claude -p "/accretion:memory-weekly $SKILL_ARGS" \
    ${PLUGIN_ARGS[@]+"${PLUGIN_ARGS[@]}"} \
    --permission-mode acceptEdits \
    --permission-prompts none \
    --allowedTools "Bash(accretion *)" "Bash(osascript *)" "Read" "Write" "Edit" "Glob" "Grep"
  status=$?

  if [ "$status" -ne 0 ]; then
    echo "=== claude exited $status; FAILED ==="
    notify_fail
    exit "$status"
  fi

  if [ "$APPLY" -eq 0 ]; then
    echo "=== dry run complete; nothing written. Re-run with --apply to commit. ==="
    exit 0
  fi

  # Postflight: a run that exits 0 having quietly done nothing is this
  # pipeline's real failure mode. doctor decides whether the run counts as healthy.
  echo "--- doctor (postflight) ---"
  if node "$SERVER_REPO/dist/cli/main.js" doctor; then
    echo "=== done $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  else
    echo "=== run completed but doctor reports failures; see above ==="
    notify "run finished, but doctor still reports failures; see $LOG" \
           "memory-weekly needs attention ($VAULT)"
  fi
} >>"$LOG" 2>&1
