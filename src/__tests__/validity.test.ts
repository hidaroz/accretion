import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readValidity, validityLine } from "../engine/context/validity.js";
import { runGarden } from "../engine/lifecycle/garden.js";

const now = new Date("2026-09-08T00:00:00Z");

describe("validity", () => {
  it("reads quoted and bare dates alike, and flags overdue review", () => {
    expect(readValidity({ last_reviewed: "2026-07-21", review_by: "2026-08-15" }, now)).toEqual({
      lastReviewed: "2026-07-21",
      reviewBy: "2026-08-15",
      overdue: true,
    });
    expect(readValidity({ last_reviewed: new Date("2026-07-21T00:00:00Z"), review_by: new Date("2026-12-01T00:00:00Z") }, now)).toEqual({
      lastReviewed: "2026-07-21",
      reviewBy: "2026-12-01",
      overdue: false,
    });
    expect(readValidity({ superseded_by: "[[brief-routing-v2]]", valid_from: "2026-01-01" }, now)).toEqual({
      supersededBy: "brief-routing-v2",
      validFrom: "2026-01-01",
    });
    expect(readValidity({ title: "x" }, now)).toEqual({});
  });

  it("renders one line, or nothing when there are no fields", () => {
    expect(validityLine({}, now)).toBeNull();
    expect(validityLine({ last_reviewed: "2026-07-21" }, now)).toBe("Last reviewed 2026-07-21.");
    expect(validityLine({ last_reviewed: "2026-07-21", review_by: "2026-08-15" }, now)).toBe(
      "Last reviewed 2026-07-21. Review was due 2026-08-15 (24 days overdue); treat details as possibly stale."
    );
    expect(validityLine({ review_by: "2026-12-01", superseded_by: "brief-new" }, now)).toBe(
      "Superseded by [[brief-new]]; read that instead. Review due 2026-12-01."
    );
  });
});

describe("garden stale rule", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-stale-")));
    const w = (rel: string, body: string) => fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }).then(() => fs.writeFile(path.join(root, rel), body));
    await w("01/brief-overdue.md", "---\ntitle: Overdue\ntags:\n  - type/brief\nlast_reviewed: 2026-08-01\nreview_by: 2026-08-15\n---\n# Overdue\n");
    await w("01/brief-old.md", "---\ntitle: Old\ntags:\n  - type/brief\nlast_reviewed: 2026-01-01\n---\n# Old\n");
    await w("01/brief-fresh.md", "---\ntitle: Fresh\ntags:\n  - type/brief\nlast_reviewed: 2026-09-01\nreview_by: 2026-12-01\n---\n# Fresh\n");
    await w("02/playbook-gone.md", "---\ntitle: Gone\ntags:\n  - type/playbook\nsuperseded_by: playbook-new\n---\n# Gone\n");
    await w("Knowledge/note.md", "---\ntitle: Note\ntags:\n  - type/note\nlast_reviewed: 2025-01-01\n---\n# Note\n");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("flags overdue, superseded and long-unreviewed briefs, not fresh ones or plain notes", async () => {
    const r = await runGarden(root, { rules: ["stale"], now, staleDays: 90 });
    expect(r.issues.map((i) => [i.path, i.detail])).toEqual([
      ["01/brief-old.md", "last reviewed 2026-01-01, 250 days ago"],
      ["01/brief-overdue.md", "review was due 2026-08-15"],
      ["02/playbook-gone.md", "superseded by playbook-new"],
    ]);
  });
});
