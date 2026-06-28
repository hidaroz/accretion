#!/usr/bin/env bash
#
# Launchd wrapper that starts the obsidian-mcp HTTP server. Sources the repo's
# .env (API_KEY, VAULTS_CONFIG, PORT, HOST) so the launchd-spawned process has
# the same config as `npm start`. Installed by `bootstrap.mjs --server-autostart`.
#
set -uo pipefail

# Derive the repo from this script's own location — no hardcoded machine path.
SERVER_REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SERVER_REPO"

# launchd hands processes a minimal PATH — make node resolvable.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

# Load .env if present (node also loads it via dotenv, but exporting here makes
# the config visible to anything the wrapper does before node starts).
if [ -f "$SERVER_REPO/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$SERVER_REPO/.env"
  set +a
fi

if [ ! -d "$SERVER_REPO/dist" ]; then
  echo "dist/ missing — building…"
  npm run build
fi

exec node dist/index.js
