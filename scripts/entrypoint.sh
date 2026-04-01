#!/bin/sh
set -e

VAULT_PATH="${VAULT_PATH:-/app/vault}"
VAULT_GIT_REPO="${VAULT_GIT_REPO:-}"
GIT_TIMEOUT="${GIT_TIMEOUT:-60}"

# If a git repo URL is configured, clone or pull the vault
if [ -n "$VAULT_GIT_REPO" ]; then
  if [ -d "$VAULT_PATH/.git" ]; then
    echo "Pulling latest vault changes..."
    cd "$VAULT_PATH"
    if timeout "${GIT_TIMEOUT}" git fetch origin main --quiet 2>/dev/null; then
      git reset --hard origin/main --quiet
      echo "Vault pulled successfully at $(date)"
    else
      echo "WARNING: git fetch failed or timed out after ${GIT_TIMEOUT}s — using existing vault"
    fi
    cd /app
  else
    echo "Cloning vault repository..."
    if timeout "${GIT_TIMEOUT}" git clone "$VAULT_GIT_REPO" "$VAULT_PATH" 2>/dev/null; then
      echo "Vault cloned successfully at $(date)"
    else
      echo "WARNING: git clone failed or timed out after ${GIT_TIMEOUT}s — starting with empty vault"
    fi
  fi
fi

# Ensure vault directory exists
mkdir -p "$VAULT_PATH"

# Verify vault state
NOTE_COUNT=$(find "$VAULT_PATH" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
echo "Vault contains ${NOTE_COUNT} markdown files"

# Start the MCP server
exec node dist/index.js
