import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFile = promisify(execFileCb);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const MCP = path.join(REPO, "dist", "mcp", "main.js");
const CLI = path.join(REPO, "dist", "cli", "main.js");

/**
 * The MCP adapter and the CLI render the same command specs. This spawns the
 * real stdio server and compares its JSON to `accretion <cmd> --json`. Needs a
 * build; skipped when dist/ is absent so `npm test` without a build still passes.
 */
describe.skipIf(!existsSync(MCP))("MCP adapter parity with the CLI", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let client: Client;

  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-mcp-")));
    await fs.cp(path.join(REPO, "demo-vault"), path.join(root, "vault"), { recursive: true });
    await fs.rm(path.join(root, "vault", ".mcp", "search-index.json"), { force: true });
    const configPath = path.join(root, "vaults.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ vaults: [{ id: "demo", path: path.join(root, "vault"), displayName: "Demo", default: true, semantic: false }] })
    );
    env = { ...process.env, VAULTS_CONFIG: configPath, LOG_LEVEL: "error" };
    client = new Client({ name: "parity-test", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP], env: env as Record<string, string> }));
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("exposes exactly the six flagged tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["brief", "context", "list", "propose", "read", "search"]);
  });

  it("search returns the same JSON as the CLI", async () => {
    const query = "why does routing abstain instead of guessing";
    const viaMcp = await client.callTool({ name: "search", arguments: { query, limit: 4 } });
    const text = (viaMcp.content as Array<{ type: string; text: string }>)[0].text;
    const { stdout } = await execFile(process.execPath, [CLI, "search", query, "--limit", "4", "--json"], { env });
    expect(JSON.parse(text)).toEqual(JSON.parse(stdout));
  });

  it("brief renders markdown and abstains honestly", async () => {
    const hit = await client.callTool({ name: "brief", arguments: { topic: "routing" } });
    const hitText = (hit.content as Array<{ text: string }>)[0].text;
    expect(hitText.startsWith("# Brief routing")).toBe(true);
    expect(hitText).toContain("_Resolved via: direct_map_");
    const miss = await client.callTool({ name: "brief", arguments: { topic: "vector database sharding" } });
    expect((miss.content as Array<{ text: string }>)[0].text).toContain("not routing to avoid a wrong brief");
  });

  it("propose writes through the allowlist and reports the path", async () => {
    const r = await client.callTool({
      name: "propose",
      arguments: { title: "Via MCP", source: ["sessions/2026/07-14/accretion-a1b2c3d4.md"], body: "a synthesis worth keeping" },
    });
    const out = JSON.parse((r.content as Array<{ text: string }>)[0].text) as { path: string };
    expect(out.path.startsWith("proposals/notes/")).toBe(true);
    const raw = await fs.readFile(path.join(root, "vault", out.path), "utf-8");
    expect(raw).toContain("a synthesis worth keeping");
  });

  it("surfaces input errors as isError without crashing the server", async () => {
    const r = await client.callTool({ name: "read", arguments: { path: "../../etc/passwd" } });
    expect(r.isError).toBe(true);
    const again = await client.listTools();
    expect(again.tools.length).toBe(6);
  });
});
