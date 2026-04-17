#!/bin/sh
set -e

# Move to repo root (scripts/ is one level deep)
cd "$(dirname "$0")/.."

# Load .env into the environment — launchd does not source .env files.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# Best-effort vault refresh. Never fail the boot if git is offline or diverged.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if ! git pull --ff-only 2>&1; then
    echo "WARN: git pull --ff-only failed at $(date) — continuing with local state"
  fi
fi

exec node dist/index.js
