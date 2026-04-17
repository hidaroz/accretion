#!/bin/sh
# One-shot vault sync for the local macOS LaunchAgent.
# The repo itself contains the vault (vault/ is committed), so pulling the
# repo is what refreshes the vault contents. Use --ff-only so we never
# clobber local-only commits or uncommitted Obsidian edits.

cd "$(dirname "$0")/.."

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "$(date): not a git repo, skipping sync"
  exit 0
fi

if git pull --ff-only 2>&1; then
  echo "$(date): sync ok at $(git rev-parse --short HEAD)"
else
  echo "$(date): sync pull failed (likely diverged or offline) — leaving repo untouched"
fi
