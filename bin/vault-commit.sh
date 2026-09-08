#!/usr/bin/env bash
#
# Timer-driven vault committer: the one git writer for every registered vault.
# Wraps `accretion commit`, which reads gitAutoCommit / gitAutoPush per vault
# from vaults.json. Schedule with launchd (see launchd/) every 20 minutes.
#
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

# launchd hands processes a minimal PATH; only prepend directories that exist.
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.npm-global/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH

exec node "$REPO/dist/cli/main.js" commit "$@"
