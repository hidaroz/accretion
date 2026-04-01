#!/bin/sh
# Periodic vault sync script — called by the Node process via setInterval
# or can be invoked by cron in non-containerized setups

VAULT_PATH="${VAULT_PATH:-/app/vault}"

if [ ! -d "$VAULT_PATH/.git" ]; then
  echo "No git repo at $VAULT_PATH, skipping sync"
  exit 0
fi

cd "$VAULT_PATH"

LOCAL=$(git rev-parse HEAD)
git fetch origin main --quiet
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  git reset --hard origin/main --quiet
  echo "$(date): Vault synced to $(git rev-parse --short HEAD)"
fi
