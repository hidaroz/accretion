import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM helper, no types (kept build-free for fresh-machine bootstrap)
import { mergeSessionEndHook, hasSessionJournalHook, sessionJournalCommand } from "../../scripts/lib/settings-merge.mjs";

const CMD = 'node "/home/u/.claude/hooks/session-journal.mjs"';

describe("sessionJournalCommand", () => {
  it("builds the command from a hooks dir, trimming a trailing slash", () => {
    expect(sessionJournalCommand("/home/u/.claude/hooks")).toBe(CMD);
    expect(sessionJournalCommand("/home/u/.claude/hooks/")).toBe(CMD);
  });

  it("quotes the path so a home directory with a space still works", () => {
    // Unquoted, `/Users/First Last/...` writes a hook that fails on every
    // session — silently, since nothing surfaces a hook's exit status.
    expect(sessionJournalCommand("/Users/First Last/.claude/hooks")).toBe(
      'node "/Users/First Last/.claude/hooks/session-journal.mjs"'
    );
  });
});

describe("mergeSessionEndHook", () => {
  it("adds the SessionEnd capture hook to empty settings", () => {
    const { settings, changed } = mergeSessionEndHook({}, CMD);
    expect(changed).toBe(true);
    expect(settings.hooks.SessionEnd).toEqual([
      { matcher: "", hooks: [{ type: "command", command: CMD, timeout: 30, async: true }] },
    ]);
  });

  it("is idempotent — a second merge makes no change and no duplicate", () => {
    const first = mergeSessionEndHook({}, CMD);
    const second = mergeSessionEndHook(first.settings, CMD);
    expect(second.changed).toBe(false);
    expect(second.settings.hooks.SessionEnd).toHaveLength(1);
  });

  it("detects an existing session-journal hook even at a different path", () => {
    const existing = {
      hooks: {
        SessionEnd: [
          { matcher: "", hooks: [{ type: "command", command: "node /Users/x/.claude/hooks/session-journal.mjs" }] },
        ],
      },
    };
    expect(hasSessionJournalHook(existing)).toBe(true);
    expect(mergeSessionEndHook(existing, CMD).changed).toBe(false);
  });

  it("preserves unrelated hooks and other settings keys; does not mutate input", () => {
    const input = {
      permissions: { allow: ["Bash"] },
      hooks: {
        SessionEnd: [
          { matcher: "", hooks: [{ type: "command", command: "node /other/hook.mjs" }] },
        ],
      },
    };
    const snapshot = JSON.stringify(input);
    const { settings, changed } = mergeSessionEndHook(input, CMD);
    expect(changed).toBe(true);
    expect(JSON.stringify(input)).toBe(snapshot); // input untouched
    expect(settings.permissions).toEqual({ allow: ["Bash"] });
    expect(settings.hooks.SessionEnd).toHaveLength(2); // existing kept + ours appended
  });
});
