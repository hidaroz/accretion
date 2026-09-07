// Pure helpers for idempotently wiring accretion's hooks into a Claude Code
// settings.json. No I/O: bootstrap.mjs reads and writes, the unit test
// exercises these directly. Plain ESM (no build step) so it can be imported on
// a fresh machine before `npm run build`.

/** `node "<hooksDir>/<file>"`; quoted, because a home directory may contain a space. */
export function hookCommand(hooksDir, file) {
  return `node "${hooksDir.replace(/\/$/, "")}/${file}"`;
}

export function sessionJournalCommand(hooksDir) {
  return hookCommand(hooksDir, "session-journal.mjs");
}

export function promptRecallCommand(hooksDir) {
  return hookCommand(hooksDir, "prompt-recall.mjs");
}

/** True if any group under `event` already runs a command containing `needle`. */
export function hasHook(settings, event, needle) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (g) =>
      Array.isArray(g?.hooks) &&
      g.hooks.some((h) => typeof h?.command === "string" && h.command.includes(needle))
  );
}

export function hasSessionJournalHook(settings) {
  return hasHook(settings, "SessionEnd", "session-journal.mjs");
}

export function hasPromptRecallHook(settings) {
  return hasHook(settings, "UserPromptSubmit", "prompt-recall.mjs");
}

/**
 * Return a new settings object with a command hook added under `event`, iff no
 * hook containing `needle` is already there. Never mutates the input; never
 * clobbers other hooks or keys. `{ settings, changed }`.
 */
export function mergeHook(settings, event, needle, command, options = {}) {
  const next = structuredClone(settings ?? {});
  if (hasHook(next, event, needle)) return { settings: next, changed: false };

  next.hooks = next.hooks ?? {};
  const groups = Array.isArray(next.hooks[event]) ? next.hooks[event] : [];
  const hook = { type: "command", command, timeout: options.timeout ?? 30 };
  if (options.async) hook.async = true;
  groups.push({ matcher: "", hooks: [hook] });
  next.hooks[event] = groups;
  return { settings: next, changed: true };
}

export function mergeSessionEndHook(settings, command) {
  return mergeHook(settings, "SessionEnd", "session-journal.mjs", command, { timeout: 30, async: true });
}

/** Recall injects context, so it runs synchronously with a short timeout. */
export function mergePromptRecallHook(settings, command) {
  return mergeHook(settings, "UserPromptSubmit", "prompt-recall.mjs", command, { timeout: 10 });
}
