import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error — the capture hook is plain ESM, outside the TS build.
import { findExistingSessionNote, readCreated } from "../../hooks/session-journal.mjs";

/**
 * A resumed session ends more than once, and the hook used to write to that
 * day's date directory every time, so one note could end up existing several
 * times over, byte-identical but for `created:`. Retrieval degraded
 * accordingly — a single semantic query could return four copies of the same
 * note as four of its five hits.
 *
 * The fix is to find the note this session already owns and update it there.
 */
describe("findExistingSessionNote", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(path.join(tmpdir(), "vault-"));
  });
  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  const write = (rel: string, body: string) => {
    const full = path.join(vault, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
    return full;
  };

  it("returns null when the session has no note yet", () => {
    write("sessions/2026/06-14/atlas-web-app-11111111.md", "x");
    expect(findExistingSessionNote(vault, "atlas-web-app-99999999.md")).toBeNull();
  });

  it("returns null when there is no sessions/ directory at all", () => {
    expect(findExistingSessionNote(vault, "atlas-web-app-11111111.md")).toBeNull();
  });

  it("finds a note written under an earlier date directory", () => {
    write("sessions/2026/06-14/atlas-mobile-app-7350c33b.md", "x");
    expect(findExistingSessionNote(vault, "atlas-mobile-app-7350c33b.md")).toBe(
      "sessions/2026/06-14/atlas-mobile-app-7350c33b.md"
    );
  });

  it("finds a note that has already been archived", () => {
    write("sessions/archive/2026/05-24/atlas-web-app-85f70f37.md", "x");
    expect(findExistingSessionNote(vault, "atlas-web-app-85f70f37.md")).toBe(
      "sessions/archive/2026/05-24/atlas-web-app-85f70f37.md"
    );
  });

  it("keys on project too, so one session run from two repos keeps two notes", () => {
    // e6e38ce4 really did run from both the repo root and the mobile app.
    write("sessions/2026/08-02/atlas-e6e38ce4.md", "root");
    write("sessions/2026/08-02/atlas-mobile-app-e6e38ce4.md", "mobile");

    expect(findExistingSessionNote(vault, "atlas-e6e38ce4.md")).toBe(
      "sessions/2026/08-02/atlas-e6e38ce4.md"
    );
    expect(findExistingSessionNote(vault, "atlas-mobile-app-e6e38ce4.md")).toBe(
      "sessions/2026/08-02/atlas-mobile-app-e6e38ce4.md"
    );
  });

  it("does not match a digest that happens to share the name", () => {
    write("sessions/digests/2026-W30-atlas.md", "digest");
    expect(findExistingSessionNote(vault, "atlas-web-app-7350c33b.md")).toBeNull();
  });
});

describe("readCreated", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(path.join(tmpdir(), "vault-"));
  });
  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  const note = (body: string) => {
    const full = path.join(vault, "note.md");
    writeFileSync(full, body, "utf8");
    return full;
  };

  /**
   * Digests group sessions by created-week. If a rewrite bumped `created`, an
   * already-digested note would hop into a later week and read as an
   * uncovered session forever — a backlog that regenerates itself.
   */
  it("reads a quoted created timestamp", () => {
    const p = note("---\ntitle: 'x'\ncreated: '2026-06-14T19:15:51.009Z'\n---\n\n# x\n");
    expect(readCreated(p)).toBe("2026-06-14T19:15:51.009Z");
  });

  it("reads an unquoted created timestamp", () => {
    const p = note("---\ncreated: 2026-06-14T19:15:51.009Z\n---\n");
    expect(readCreated(p)).toBe("2026-06-14T19:15:51.009Z");
  });

  it("is not fooled by a later line that merely mentions created", () => {
    const p = note(
      "---\ncreated: '2026-06-14T19:15:51.009Z'\n---\n\n# x\n\n- created: 2026-08-05 in the body\n"
    );
    expect(readCreated(p)).toBe("2026-06-14T19:15:51.009Z");
  });

  it("returns null when there is no created field", () => {
    expect(readCreated(note("---\ntitle: 'x'\n---\n"))).toBeNull();
  });

  it("returns null for a missing file rather than throwing", () => {
    expect(readCreated(path.join(vault, "nope.md"))).toBeNull();
  });
});
