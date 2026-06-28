#!/usr/bin/env bash
#
# Autonomous weekly memory curation. Invoked by launchd (com.work.memory-weekly)
# or by hand for a supervised first run. Runs `/memory-weekly --autonomous`
# headless and logs to ~/Library/Logs/work-memory-weekly/.
#
# First-run validation (do this once, watching the output, before trusting the
# schedule):
#   bin/memory-weekly-run.sh work
#
set -uo pipefail

VAULT="${1:-work}"
SERVER_REPO="/Users/hidaroz/devprojects/obsidian-mcp-server"
LOG_DIR="$HOME/Library/Logs/work-memory-weekly"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d).log"

# launchd hands processes a minimal PATH — make node/claude/git resolvable.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

notify_fail() {
  osascript -e "display notification \"run failed — see $LOG\" with title \"memory-weekly FAILED ($VAULT)\"" >/dev/null 2>&1 || true
}

{
  echo "=== memory-weekly run $(date -u +%Y-%m-%dT%H:%M:%SZ) vault=$VAULT ==="

  # The memory-*.mjs scripts import compiled dist/. Build if missing.
  if [ ! -d "$SERVER_REPO/dist" ]; then
    echo "dist/ missing — building…"
    ( cd "$SERVER_REPO" && npm run build ) || { echo "BUILD FAILED"; notify_fail; exit 1; }
  fi

  # Headless run with a constrained allowlist (NOT --dangerously-skip-permissions).
  # The skill only needs: node (the memory-*.mjs scripts), git (commit/push),
  # osascript (the notification), and file Read/Write/Edit for digests/proposals.
  # If the first manual run hits a permission prompt, widen the list here.
  claude -p "/memory-weekly --autonomous --vault $VAULT" \
    --permission-mode acceptEdits \
    --allowedTools "Bash(node:*)" "Bash(git:*)" "Bash(osascript:*)" "Read" "Write" "Edit"
  status=$?

  if [ "$status" -ne 0 ]; then
    echo "=== claude exited $status — FAILED ==="
    notify_fail
    exit "$status"
  fi
  echo "=== done $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
} >>"$LOG" 2>&1
