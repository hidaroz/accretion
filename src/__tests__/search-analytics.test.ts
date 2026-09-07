import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SearchAnalytics, type SearchLogEntry } from "../engine/retrieval/search-analytics.js";

let vaultRoot: string;
let logPath: string;

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "analytics-test-"));
  // The logger appends only — the .mcp dir must already exist (created at onboarding).
  await fs.mkdir(path.join(vaultRoot, ".mcp"), { recursive: true });
  logPath = path.join(vaultRoot, ".mcp", "search-log.jsonl");
});

afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

async function readEntries(): Promise<SearchLogEntry[]> {
  const raw = await fs.readFile(logPath, "utf-8");
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as SearchLogEntry);
}

describe("SearchAnalytics", () => {
  it("appends a hybrid_search entry with the rich telemetry fields", async () => {
    const analytics = new SearchAnalytics(vaultRoot);
    const entry: SearchLogEntry = {
      timestamp: "2026-06-28T00:00:00.000Z",
      tool: "hybrid_search",
      query: "what is the embedding index migration plan",
      vault: "work",
      resultCount: 5,
      topPaths: ["10-Roadmap/Embedding Index Migration.md"],
      limit: 8,
      semanticAvailable: true,
      route: { method: "direct_map", path: "02-Retrieval/brief-embedding-index.md", score: 9.1 },
      pinApplied: true,
      keywordTopPaths: ["a.md", "b.md"],
      semanticTopPaths: ["c.md"],
      latencyMs: 12,
    };

    await analytics.log(entry);

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(entry); // round-trips losslessly through JSONL
    expect(entries[0].route?.method).toBe("direct_map");
    expect(entries[0].pinApplied).toBe(true);
    expect(typeof entries[0].latencyMs).toBe("number");
  });

  it("appends (does not overwrite) across multiple logs and stays backward-compatible", async () => {
    const analytics = new SearchAnalytics(vaultRoot);
    // A legacy-shaped entry (search_notes) with none of the new optional fields.
    await analytics.log({
      timestamp: "2026-06-28T00:00:01.000Z",
      tool: "search_notes",
      query: "roasting",
      vault: "work",
      resultCount: 3,
      topPaths: ["05-Kitchen/brief-coffee-roasting.md"],
    });
    await analytics.log({
      timestamp: "2026-06-28T00:00:02.000Z",
      tool: "hybrid_search",
      query: "roasting batches",
      vault: "work",
      resultCount: 2,
      topPaths: ["05-Kitchen/brief-coffee-roasting.md"],
      pinApplied: false,
    });

    const entries = await readEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].tool).toBe("search_notes");
    expect(entries[0].route).toBeUndefined();
    expect(entries[1].tool).toBe("hybrid_search");
    expect(entries[1].pinApplied).toBe(false);
  });
});
