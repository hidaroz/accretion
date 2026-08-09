#!/bin/sh
set -e

VAULT_PATH="${VAULT_PATH:-/app/vault}"
VAULT_GIT_REPO="${VAULT_GIT_REPO:-}"
VAULT_GIT_REMOTE="${VAULT_GIT_REMOTE:-origin}"
GIT_TIMEOUT="${GIT_TIMEOUT:-60}"

# If a git repo URL is configured, clone or pull the vault
if [ -n "$VAULT_GIT_REPO" ]; then
  if [ -d "$VAULT_PATH/.git" ]; then
    echo "Pulling latest vault changes..."
    cd "$VAULT_PATH"
    # Resolve the remote's default branch rather than assuming "main" — a vault
    # on master would otherwise never sync, silently.
    BRANCH=$(git symbolic-ref --quiet --short "refs/remotes/$VAULT_GIT_REMOTE/HEAD" 2>/dev/null | sed "s|^$VAULT_GIT_REMOTE/||")
    [ -n "$BRANCH" ] || BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if timeout "${GIT_TIMEOUT}" git fetch "$VAULT_GIT_REMOTE" "$BRANCH" --quiet 2>/dev/null; then
      # A container vault is a disposable clone, so discarding local state is
      # the intended behaviour here — but it stays opt-out via VAULT_SYNC_RESET
      # for anyone who bind-mounts a real vault into the container.
      if [ "${VAULT_SYNC_RESET:-1}" = "1" ]; then
        git reset --hard "$VAULT_GIT_REMOTE/$BRANCH" --quiet
      else
        git merge --ff-only "$VAULT_GIT_REMOTE/$BRANCH" --quiet 2>/dev/null \
          || echo "WARNING: vault diverged from $VAULT_GIT_REMOTE/$BRANCH — not syncing"
      fi
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
