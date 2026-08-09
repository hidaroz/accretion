// Pure helpers for idempotently wiring the SessionEnd capture hook into a
// Claude Code settings.json. No I/O — bootstrap.mjs does the reading/writing,
// and the unit test exercises these directly. Plain ESM (no build step) so it
// can be imported on a fresh machine before `npm run build`.

/**
 * The command a SessionEnd hook runs to capture a session into the vault.
 *
 * The path is quoted: it is interpolated into a shell command, and a home
 * directory containing a space (`/Users/First Last/...`) would otherwise write
 * a hook that silently fails on every session.
 */
export function sessionJournalCommand(hooksDir) {
  return `node "${hooksDir.replace(/\/$/, "")}/session-journal.mjs"`;
}

/** True if any SessionEnd group already runs the session-journal capture hook. */
export function hasSessionJournalHook(settings) {
  const groups = settings?.hooks?.SessionEnd;
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (g) =>
      Array.isArray(g?.hooks) &&
      g.hooks.some(
        (h) => typeof h?.command === "string" && h.command.includes("session-journal.mjs")
      )
  );
}

/**
 * Return a new settings object with the SessionEnd capture hook added, iff it
 * isn't already present. Never mutates the input; never clobbers other hooks or
 * keys. `{ settings, changed }` — `changed:false` means it was already wired.
 */
export function mergeSessionEndHook(settings, command) {
  const next = structuredClone(settings ?? {});
  if (hasSessionJournalHook(next)) return { settings: next, changed: false };

  next.hooks = next.hooks ?? {};
  const groups = Array.isArray(next.hooks.SessionEnd) ? next.hooks.SessionEnd : [];
  groups.push({
    matcher: "",
    hooks: [{ type: "command", command, timeout: 30, async: true }],
  });
  next.hooks.SessionEnd = groups;
  return { settings: next, changed: true };
}
