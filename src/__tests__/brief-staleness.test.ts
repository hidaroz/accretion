import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  invertBriefMap,
  getBriefReviewDate,
  matchesKeyword,
  getStaleBriefs,
} from "../vault/brief-staleness.js";

const DAY = 24 * 3600000;

describe("invertBriefMap", () => {
  it("inverts keyword→path to path→keywords", () => {
    const inverted = invertBriefMap({
      roasting: "05-Kitchen/brief-coffee-roasting.md",
      sourdough: "05-Kitchen/brief-coffee-roasting.md",
      auth: "03-Architecture/brief-auth.md",
    });
    expect(inverted.get("05-Kitchen/brief-coffee-roasting.md")).toEqual([
      "roasting",
      "sourdough",
    ]);
    expect(inverted.get("03-Architecture/brief-auth.md")).toEqual(["auth"]);
  });

  it("normalizes leading ./ and skips empty values", () => {
    const inverted = invertBriefMap({
      a: "./notes/a.md",
      b: "",
    });
    expect(inverted.has("notes/a.md")).toBe(true);
    expect(inverted.size).toBe(1);
  });
});

describe("getBriefReviewDate", () => {
  const mtime = new Date("2026-01-01T00:00:00Z");

  it("prefers last_reviewed", () => {
    const result = getBriefReviewDate(
      { last_reviewed: "2026-06-01", updated: "2026-05-01" },
      mtime
    );
    expect(result.source).toBe("last_reviewed");
    expect(result.date.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("falls back to updated", () => {
    const result = getBriefReviewDate({ updated: "2026-05-01" }, mtime);
    expect(result.source).toBe("updated");
  });

  it("falls back to mtime", () => {
    const result = getBriefReviewDate({}, mtime);
    expect(result.source).toBe("mtime");
    expect(result.date).toBe(mtime);
  });

  it("accepts Date instances from YAML parsing", () => {
    const d = new Date("2026-05-20T00:00:00Z");
    const result = getBriefReviewDate({ last_reviewed: d }, mtime);
    expect(result.source).toBe("last_reviewed");
    expect(result.date).toBe(d);
  });

  it("skips malformed values in the chain", () => {
    const result = getBriefReviewDate(
      { last_reviewed: "garbage", updated: "2026-05-01" },
      mtime
    );
    expect(result.source).toBe("updated");
  });
});

describe("matchesKeyword", () => {
  it("matches whole words case-insensitively", () => {
    expect(matchesKeyword("Fixed the RLS policies", "rls")).toBe(true);
  });

  it("does not match inside other words", () => {
    expect(matchesKeyword("the girls went home", "rls")).toBe(false);
    expect(matchesKeyword("the author wrote it", "auth")).toBe(false);
  });

  it("matches multi-word keywords", () => {
    expect(matchesKeyword("updated time tracking logic", "time tracking")).toBe(true);
  });
});

describe("getStaleBriefs", () => {
  let vaultRoot: string;

  async function write(relativePath: string, content: string): Promise<void> {
    const abs = path.join(vaultRoot, relativePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  function iso(daysAgo: number): string {
    return new Date(Date.now() - daysAgo * DAY).toISOString();
  }

  async function writeBrief(
    relativePath: string,
    lastReviewedDaysAgo: number
  ): Promise<void> {
    await write(
      relativePath,
      `---\ntitle: Brief\ntags:\n  - type/brief\nlast_reviewed: '${iso(lastReviewedDaysAgo).slice(0, 10)}'\n---\n\n> TL;DR: a brief\n`
    );
  }

  async function writeSession(
    relativePath: string,
    createdDaysAgo: number,
    topics: string[]
  ): Promise<void> {
    await write(
      relativePath,
      `---\ntitle: Session\ntags:\n  - type/session\n  - project/proj-a\ncreated: '${iso(createdDaysAgo)}'\n---\n\n## Topics\n\n${topics.map((t) => `- ${t}`).join("\n")}\n`
    );
  }

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stale-test-"));
    await write(
      ".mcp/brief-map.json",
      JSON.stringify({
        roasting: "briefs/brief-coffee.md",
        sourdough: "briefs/brief-coffee.md",
        cycling: "briefs/brief-cycling.md",
      })
    );
  });

  afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it("returns stale briefs with keyword-matched sessions since review", async () => {
    await writeBrief("briefs/brief-coffee.md", 60);
    await writeSession("sessions/2026/06-01/s1.md", 10, [
      "fixed roasting rate rounding",
    ]);

    const result = await getStaleBriefs(vaultRoot, { staleDays: 21 });
    expect(result).toHaveLength(1);
    expect(result[0].briefPath).toBe("briefs/brief-coffee.md");
    expect(result[0].reviewDateSource).toBe("last_reviewed");
    expect(result[0].matchedSessions).toHaveLength(1);
    expect(result[0].matchedSessions[0].matchedKeywords).toEqual(["roasting"]);
  });

  it("excludes sessions created before the review date", async () => {
    await writeBrief("briefs/brief-coffee.md", 30);
    await writeSession("sessions/2026/04-01/old.md", 45, [
      "roasting work from before the review",
    ]);

    const result = await getStaleBriefs(vaultRoot, { staleDays: 21 });
    expect(result).toHaveLength(0);
  });

  it("excludes briefs reviewed recently", async () => {
    await writeBrief("briefs/brief-coffee.md", 5);
    await writeSession("sessions/2026/06-08/s1.md", 2, ["roasting changes"]);

    const result = await getStaleBriefs(vaultRoot, { staleDays: 21 });
    expect(result).toHaveLength(0);
  });

  it("excludes briefs with no matching session activity", async () => {
    await writeBrief("briefs/brief-coffee.md", 60);
    await writeSession("sessions/2026/06-08/s1.md", 2, [
      "worked on mobile navigation",
    ]);

    const result = await getStaleBriefs(vaultRoot, { staleDays: 21 });
    expect(result).toHaveLength(0);
  });

  it("excludes briefs with an open update proposal", async () => {
    await writeBrief("briefs/brief-coffee.md", 60);
    await writeSession("sessions/2026/06-08/s1.md", 2, ["roasting changes"]);
    await write(
      "proposals/brief-updates/2026-W24-brief-coffee.md",
      "---\ntags:\n  - type/brief-proposal\nstatus: proposed\ntarget_brief: briefs/brief-coffee.md\n---\n\n## Why\n"
    );

    const result = await getStaleBriefs(vaultRoot, { staleDays: 21 });
    expect(result).toHaveLength(0);
  });

  it("includes briefs whose proposal was already applied", async () => {
    await writeBrief("briefs/brief-coffee.md", 60);
    await writeSession("sessions/2026/06-08/s1.md", 2, ["roasting changes"]);
    await write(
      "proposals/brief-updates/2026-W20-brief-coffee.md",
      "---\ntags:\n  - type/brief-proposal\nstatus: applied\ntarget_brief: briefs/brief-coffee.md\n---\n\n## Why\n"
    );

    const result = await getStaleBriefs(vaultRoot, { staleDays: 21 });
    expect(result).toHaveLength(1);
  });

  it("skips brief-map entries pointing at missing notes", async () => {
    // brief-cycling.md is mapped but never written
    await writeBrief("briefs/brief-coffee.md", 60);
    await writeSession("sessions/2026/06-08/s1.md", 2, [
      "cycling and roasting changes",
    ]);

    const result = await getStaleBriefs(vaultRoot, { staleDays: 21 });
    expect(result).toHaveLength(1);
    expect(result[0].briefPath).toBe("briefs/brief-coffee.md");
  });
});
