import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendLog,
  readLog,
  formatLogLine,
  parseLogLine,
  LOG_PATH,
} from "../engine/lifecycle/log.js";

let root: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-log-")));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("event log", () => {
  it("formats and parses the fixed line grammar", () => {
    const line = formatLogLine({
      date: "2026-09-07",
      kind: "capture",
      title: "Fix | routing",
      path: "sessions/2026/09-07/x.md",
    });
    expect(line).toBe("## [2026-09-07] capture | Fix routing | sessions/2026/09-07/x.md");
    expect(parseLogLine(line)).toEqual({
      date: "2026-09-07",
      kind: "capture",
      title: "Fix routing",
      path: "sessions/2026/09-07/x.md",
    });
    expect(parseLogLine("## not a log line")).toBeNull();
  });

  it("creates the file with a header and appends without rewriting", async () => {
    await appendLog(root, { kind: "digest", title: "W36", path: "sessions/digests/2026-W36-x.md", date: "2026-09-07" });
    await appendLog(root, { kind: "archive", title: "3 archived", path: "sessions/archive/", date: "2026-09-08" });
    const raw = await fs.readFile(path.join(root, LOG_PATH), "utf-8");
    expect(raw.startsWith("---\ntitle: Vault log")).toBe(true);
    const lines = raw.split("\n").filter((l) => l.startsWith("## ["));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("archive | 3 archived");

    const entries = await readLog(root, { last: 1 });
    expect(entries).toEqual([
      { date: "2026-09-08", kind: "archive", title: "3 archived", path: "sessions/archive/" },
    ]);
    expect(await readLog(root, { kind: "digest" })).toHaveLength(1);
  });

  it("returns an empty list when there is no log yet", async () => {
    expect(await readLog(root)).toEqual([]);
  });
});
