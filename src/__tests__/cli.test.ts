import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { parseArgv, defineCommand, UsageError, helpFor } from "../cli/spec.js";
import { commands } from "../cli/commands/index.js";
import * as retrieval from "../cli/commands/retrieval.js";
import * as lifecycle from "../cli/commands/lifecycle.js";
import type { RunContext } from "../cli/spec.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const sample = defineCommand({
  name: "sample",
  group: "retrieval",
  summary: "test",
  positional: { key: "query", label: "query", rest: true },
  input: z.object({
    query: z.string().min(1),
    vault: z.string().optional(),
    limit: z.coerce.number().int().default(8),
    verbose: z.boolean().optional(),
    strict: z.boolean().default(true),
    rules: z.array(z.string()).optional(),
  }),
  async run(args) {
    return args;
  },
});

describe("parseArgv", () => {
  it("derives value-taking flags from the schema, never a hardcoded list", () => {
    const a = parseArgv(sample, ["--vault", "demo", "how", "does", "--limit", "3", "routing", "work", "--verbose"]);
    expect(a).toEqual({ query: "how does routing work", vault: "demo", limit: 3, verbose: true, strict: true });
  });

  it("supports --flag=value, --no-bool, repeated and comma arrays, and --", () => {
    const a = parseArgv(sample, ["--limit=2", "--no-strict", "--rules", "a,b", "--rules", "c", "--", "--not-a-flag"]);
    expect(a.limit).toBe(2);
    expect(a.strict).toBe(false);
    expect(a.rules).toEqual(["a", "b", "c"]);
    expect(a.query).toBe("--not-a-flag");
  });

  it("rejects unknown flags, missing values and schema violations as usage errors", () => {
    expect(() => parseArgv(sample, ["--bogus", "x"])).toThrow(UsageError);
    expect(() => parseArgv(sample, ["--limit"])).toThrow(UsageError);
    expect(() => parseArgv(sample, [])).toThrow(UsageError);
    expect(() => parseArgv(sample, ["--limit", "abc", "q"])).toThrow(UsageError);
  });

  it("renders help from the schema", () => {
    const h = helpFor(sample);
    expect(h).toContain("accretion sample <query...>");
    expect(h).toContain("--limit <value>");
    expect(h).toContain("(default 8)");
  });

  it("every registered command has a unique name and the MCP set is small", () => {
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const mcp = commands.filter((c) => c.mcp).map((c) => c.name);
    expect(mcp).toEqual(["search", "brief", "context", "read", "list", "propose"]);
  });
});

describe("commands against a demo-vault copy", () => {
  let root: string;
  let configPath: string;
  let prevConfig: string | undefined;
  const ctx: RunContext = {
    json: false,
    cwd: process.cwd(),
    env: process.env,
    stdin: async () => "body from stdin",
    stderr: () => {},
  };

  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-cli-")));
    await fs.cp(path.join(REPO, "demo-vault"), path.join(root, "vault"), { recursive: true });
    await fs.rm(path.join(root, "vault", ".mcp", "search-index.json"), { force: true });
    configPath = path.join(root, "vaults.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ vaults: [{ id: "demo", path: path.join(root, "vault"), displayName: "Demo", default: true, semantic: false }] })
    );
    prevConfig = process.env.VAULTS_CONFIG;
    process.env.VAULTS_CONFIG = configPath;
  });
  afterAll(async () => {
    if (prevConfig === undefined) delete process.env.VAULTS_CONFIG;
    else process.env.VAULTS_CONFIG = prevConfig;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("search returns the CLI JSON contract and text with the brief pinned first", async () => {
    const args = parseArgv(retrieval.search, ["how", "does", "hybrid", "search", "combine", "keyword", "and", "semantic", "results", "--limit", "3"]);
    const out = (await retrieval.search.run(args, ctx, [])) as { count: number; semantic: boolean; results: Array<{ rank: number; path: string; title: string; snippet: string }> };
    expect(out.count).toBe(3);
    expect(out.semantic).toBe(false);
    expect(out.results[0]).toMatchObject({ rank: 1, path: "02-Retrieval/brief-hybrid-retrieval.md" });
    expect(Object.keys(out.results[0]).sort()).toEqual(["path", "rank", "snippet", "title"]);
    const text = retrieval.search.format!(out, args);
    expect(text.startsWith("1. Hybrid retrieval")).toBe(true);
  });

  it("brief routes by direct map and abstains off-domain", async () => {
    const hit = (await retrieval.brief.run(parseArgv(retrieval.brief, ["routing"]), ctx, [])) as { found: boolean; method?: string; path?: string };
    expect(hit).toMatchObject({ found: true, method: "direct_map", path: "02-Retrieval/brief-brief-routing.md" });
    const miss = (await retrieval.brief.run(parseArgv(retrieval.brief, ["vector", "database", "sharding"]), ctx, [])) as { found: boolean; method: string };
    expect(miss).toMatchObject({ found: false, method: "abstain" });
  });

  it("context fair-shares a budget and names unresolved topics", async () => {
    const args = parseArgv(retrieval.context, ["retrieval", "capture", "nonsense-topic", "--max-tokens", "1500"]);
    const out = (await retrieval.context.run(args, ctx, [])) as { resolved: unknown[]; notFound: string[]; totalChars: number };
    expect(out.resolved).toHaveLength(2);
    expect(out.notFound).toEqual(["nonsense-topic"]);
    expect(out.totalChars).toBeLessThanOrEqual(1500 * 4);
  });

  it("propose writes under proposals/ with provenance and logs it; index regenerates 00-Index/index.md", async () => {
    const args = parseArgv(lifecycle.propose, ["--title", "Routing floor note", "--target", "02-Retrieval/brief-brief-routing.md", "--source", "sessions/2026/07-14/accretion-a1b2c3d4.md", "--confidence", "low"]);
    const out = (await lifecycle.propose.run(args, ctx, [])) as { path: string };
    expect(out.path.startsWith("proposals/brief-updates/")).toBe(true);
    const raw = await fs.readFile(path.join(root, "vault", out.path), "utf-8");
    expect(raw).toContain("status: proposed");
    expect(raw).toContain("target_brief: 02-Retrieval/brief-brief-routing.md");
    expect(raw).toContain("body from stdin");
    expect(raw).toContain("- sessions/2026/07-14/accretion-a1b2c3d4.md");

    const idx = (await lifecycle.index.run(parseArgv(lifecycle.index, []), ctx, [])) as { path: string; notes: number };
    expect(idx.path).toBe("00-Index/index.md");
    const page = await fs.readFile(path.join(root, "vault", idx.path), "utf-8");
    expect(page).toContain("## 02-Retrieval");
    expect(page).toContain("[[brief-hybrid-retrieval|");
    expect(page).not.toContain("accretion-a1b2c3d4");

    const log = (await lifecycle.log.run(parseArgv(lifecycle.log, ["--last", "5"]), ctx, [])) as Array<{ kind: string }>;
    expect(log.map((e) => e.kind)).toEqual(["proposal", "index"]);
  });

  it("garden flags stale source references in the demo briefs but not model names", async () => {
    const out = (await lifecycle.garden.run(parseArgv(lifecycle.garden, ["--rules", "stale-reference"]), ctx, [])) as { issues: Array<{ path: string; detail: string }> };
    expect(out.issues.some((i) => i.path === "02-Retrieval/brief-hybrid-retrieval.md")).toBe(true);
    expect(out.issues.some((i) => /\bL6\b/.test(i.detail))).toBe(false);
  });
});
