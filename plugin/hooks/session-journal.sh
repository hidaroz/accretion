#!/usr/bin/env bash
# Hook wrapper: resolves the plugin's real directory (the plugin may be reached
# through a symlink) and runs the bundled hook. Never fails the session.
SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
HERE="$(cd "$(dirname "$SELF")" && pwd)"
ROOT="${ACCRETION_HOME:-$HERE/../..}"
exec node "$ROOT/dist/hooks/session-journal.mjs" "$@"
