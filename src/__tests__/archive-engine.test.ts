import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveSessions } from "../engine/lifecycle/archive.js";
import { readLog } from "../engine/lifecycle/log.js";

async function write(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

describe("archiveSessions", () => {
  let root: string;
  const now = new Date("2026-09-07T00:00:00Z");
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-archive-")));
    await write(root, "sessions/2026/07-01/old-digested.md", "---\ntitle: Old\ntags:\n  - type/session\ncreated: '2026-07-01T00:00:00Z'\n---\n# Old\n");
    await write(root, "sessions/2026/07-02/old-undigested.md", "---\ntitle: Old2\ntags:\n  - type/session\ncreated: '2026-07-02T00:00:00Z'\n---\n# Old2\n");
    await write(root, "sessions/2026/09-06/fresh.md", "---\ntitle: Fresh\ntags:\n  - type/session\ncreated: '2026-09-06T00:00:00Z'\n---\n# Fresh\n");
    await write(
      root,
      "sessions/digests/2026-W27-x.md",
      "---\ntitle: W27\ntags:\n  - type/digest\nsources:\n  - sessions/2026/07-01/old-digested.md\n---\n# W27\n\n- [[sessions/2026/07-01/old-digested.md|Old]]\n"
    );
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("dry run reports candidates without moving", async () => {
    const r = await archiveSessions(root, { daysOld: 30, now });
    expect(r.applied).toBe(false);
    expect(r.candidates.map((c) => c.path)).toEqual(["sessions/2026/07-01/old-digested.md"]);
    expect(r.skippedUndigested).toBe(1);
    await expect(fs.access(path.join(root, "sessions/2026/07-01/old-digested.md"))).resolves.toBeUndefined();
  });

  it("apply moves, repoints digests, notifies, and logs", async () => {
    const moved: string[] = [];
    const r = await archiveSessions(root, { daysOld: 30, now, apply: true, onMoved: (f) => moved.push(f) });
    expect(r.applied).toBe(true);
    expect(r.renames).toEqual([
      { from: "sessions/2026/07-01/old-digested.md", to: "sessions/archive/2026/07-01/old-digested.md" },
    ]);
    expect(moved).toEqual(["sessions/2026/07-01/old-digested.md"]);
    expect(r.repointedDigests).toBe(1);
    const digest = await fs.readFile(path.join(root, "sessions/digests/2026-W27-x.md"), "utf-8");
    expect(digest).toContain("sessions/archive/2026/07-01/old-digested.md");
    expect(digest).not.toContain("- sessions/2026/07-01/");
    const log = await readLog(root, { kind: "archive" });
    expect(log).toHaveLength(1);
    expect(log[0].date).toBe("2026-09-07");
  });

  it("no-require-digest archives everything old", async () => {
    const r = await archiveSessions(root, { daysOld: 30, now, requireDigest: false });
    expect(r.candidates).toHaveLength(2);
  });
});
