#!/bin/sh
# Periodic vault sync — called by the Node process via setInterval, or from
# cron in non-containerized setups.
#
# Defaults to a fast-forward-only pull. This script's own docstring invites
# cron use outside a container, where VAULT_PATH is somebody's real Obsidian
# vault with unsaved edits in it; `git reset --hard` there discards work with
# no prompt and no backup. Destructive sync is opt-in via VAULT_SYNC_RESET=1,
# which is the right setting for a disposable container clone.

VAULT_PATH="${VAULT_PATH:-/app/vault}"
VAULT_GIT_REMOTE="${VAULT_GIT_REMOTE:-origin}"

if [ ! -d "$VAULT_PATH/.git" ]; then
  echo "No git repo at $VAULT_PATH, skipping sync"
  exit 0
fi

cd "$VAULT_PATH" || exit 1

# Don't assume the default branch is "main" — plenty of vaults are on master,
# and a wrong guess here means the sync silently never runs.
BRANCH=$(git symbolic-ref --quiet --short "refs/remotes/$VAULT_GIT_REMOTE/HEAD" 2>/dev/null | sed "s|^$VAULT_GIT_REMOTE/||")
[ -n "$BRANCH" ] || BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
  echo "Could not determine a branch to sync in $VAULT_PATH, skipping"
  exit 0
fi

LOCAL=$(git rev-parse HEAD)
git fetch "$VAULT_GIT_REMOTE" "$BRANCH" --quiet || {
  echo "$(date): fetch failed, leaving vault as-is"
  exit 0
}
REMOTE=$(git rev-parse "$VAULT_GIT_REMOTE/$BRANCH")

[ "$LOCAL" = "$REMOTE" ] && exit 0

if [ "$VAULT_SYNC_RESET" = "1" ]; then
  git reset --hard "$VAULT_GIT_REMOTE/$BRANCH" --quiet
  echo "$(date): Vault reset to $(git rev-parse --short HEAD)"
elif git merge --ff-only "$VAULT_GIT_REMOTE/$BRANCH" --quiet 2>/dev/null; then
  echo "$(date): Vault fast-forwarded to $(git rev-parse --short HEAD)"
else
  echo "$(date): Vault has diverged from $VAULT_GIT_REMOTE/$BRANCH — not syncing."
  echo "  Resolve by hand, or set VAULT_SYNC_RESET=1 to discard local changes."
fi
