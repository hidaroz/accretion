import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getDigestCandidates,
  getDigestedSessionPaths,
} from "../vault/digest-candidates.js";

let vaultRoot: string;

async function writeNote(
  relativePath: string,
  frontmatterYaml: string,
  body: string
): Promise<void> {
  const abs = path.join(vaultRoot, relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `---\n${frontmatterYaml}\n---\n\n${body}`);
}

async function writeSession(
  relativePath: string,
  project: string,
  created: string,
  body = "## Topics\n\n- did some work"
): Promise<void> {
  await writeNote(
    relativePath,
    `title: Session\ntags:\n  - type/session\n  - project/${project}\ncreated: '${created}'`,
    body
  );
}

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "digest-test-"));
});

afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

describe("getDigestCandidates", () => {
  it("groups sessions by project and week", async () => {
    await writeSession("sessions/2026/06-08/a-1.md", "proj-a", "2026-06-08T10:00:00Z");
    await writeSession("sessions/2026/06-09/a-2.md", "proj-a", "2026-06-09T10:00:00Z");
    await writeSession("sessions/2026/06-08/b-1.md", "proj-b", "2026-06-08T10:00:00Z");

    const result = await getDigestCandidates(vaultRoot);
    expect(result.groups).toHaveLength(2);

    const projA = result.groups.find((g) => g.project === "proj-a");
    expect(projA?.period).toBe("2026-W24");
    expect(projA?.sessions).toHaveLength(2);
    expect(projA?.digestPath).toBe("sessions/digests/2026-W24-proj-a.md");
    expect(projA?.exists).toBe(false);
  });

  it("flags groups whose digest already exists", async () => {
    await writeSession("sessions/2026/06-08/a-1.md", "proj-a", "2026-06-08T10:00:00Z");
    await writeNote(
      "sessions/digests/2026-W24-proj-a.md",
      "title: Digest\ntags:\n  - type/digest",
      "## Summary\n\nDone."
    );

    const result = await getDigestCandidates(vaultRoot);
    expect(result.groups[0].exists).toBe(true);
  });

  it("respects minSessions", async () => {
    await writeSession("sessions/2026/06-08/a-1.md", "proj-a", "2026-06-08T10:00:00Z");

    const result = await getDigestCandidates(vaultRoot, { minSessions: 2 });
    expect(result.groups).toHaveLength(0);
  });

  it("filters by project", async () => {
    await writeSession("sessions/2026/06-08/a-1.md", "proj-a", "2026-06-08T10:00:00Z");
    await writeSession("sessions/2026/06-08/b-1.md", "proj-b", "2026-06-08T10:00:00Z");

    const result = await getDigestCandidates(vaultRoot, { project: "proj-b" });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].project).toBe("proj-b");
  });

  it("skips digests and archive directories", async () => {
    await writeSession("sessions/2026/06-08/a-1.md", "proj-a", "2026-06-08T10:00:00Z");
    await writeSession("sessions/archive/2026/04-01/old.md", "proj-a", "2026-04-01T10:00:00Z");

    const result = await getDigestCandidates(vaultRoot);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].period).toBe("2026-W24");
  });

  it("reports sessions with malformed created dates", async () => {
    await writeSession("sessions/2026/06-08/bad.md", "proj-a", "not-a-date");

    const result = await getDigestCandidates(vaultRoot);
    expect(result.malformedDates).toContain("sessions/2026/06-08/bad.md");
    // still grouped (using mtime fallback)
    expect(result.groups).toHaveLength(1);
  });

  it("does not match section headings inside code blocks", async () => {
    await writeSession(
      "sessions/2026/06-08/code.md",
      "proj-a",
      "2026-06-08T10:00:00Z",
      "```md\n## Decisions\n- fake decision\n```\n\n## Decisions\n\n- real decision"
    );

    const result = await getDigestCandidates(vaultRoot);
    expect(result.groups[0].sessions[0].decisions).toEqual(["real decision"]);
  });
});

describe("getDigestedSessionPaths", () => {
  it("collects session paths from digest sources frontmatter", async () => {
    await writeNote(
      "sessions/digests/2026-W23-proj-a.md",
      "title: Digest\ntags:\n  - type/digest\nsources:\n  - sessions/2026/06-01/a-1.md\n  - sessions/2026/06-02/a-2.md",
      "## Summary\n\nDone."
    );

    const covered = await getDigestedSessionPaths(vaultRoot);
    expect(covered.has("sessions/2026/06-01/a-1.md")).toBe(true);
    expect(covered.has("sessions/2026/06-02/a-2.md")).toBe(true);
    expect(covered.size).toBe(2);
  });

  it("returns empty set when no digests exist", async () => {
    const covered = await getDigestedSessionPaths(vaultRoot);
    expect(covered.size).toBe(0);
  });
});
