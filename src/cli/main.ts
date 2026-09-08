#!/usr/bin/env node
// `accretion` entry point. Dispatches to command specs; prints text or JSON.
// Exit codes: 0 ok, 1 error, 2 usage.

import { createRequire } from "node:module";
import { commands } from "./commands/index.js";
import { parseArgv, helpFor, UsageError, type CommandSpec, type RunContext } from "./spec.js";

// Scripts and the logger print info lines to stdout; the CLI keeps stdout for results.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

function overallHelp(): string {
  const groups: Record<string, CommandSpec[]> = { retrieval: [], lifecycle: [], ops: [] };
  for (const c of commands) groups[c.group].push(c);
  const lines = [
    `accretion ${pkg.version}: curated agent memory over Obsidian vaults`,
    "",
    "Usage: accretion <command> [args] [--json]",
    "",
  ];
  for (const [g, cs] of Object.entries(groups)) {
    lines.push(`${g}:`);
    for (const c of cs) lines.push(`  ${c.name.padEnd(20)} ${c.summary}`);
    lines.push("");
  }
  lines.push("Run `accretion <command> --help` for flags. Registry: VAULTS_CONFIG, ~/.config/accretion/vaults.json.");
  return lines.join("\n");
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "-h") {
    console.log(overallHelp());
    return 0;
  }
  if (name === "--version" || name === "-v") {
    console.log(pkg.version);
    return 0;
  }
  const spec = commands.find((c) => c.name === name);
  if (!spec) {
    console.error(`unknown command: ${name}\n\n${overallHelp()}`);
    return 2;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(helpFor(spec));
    return 0;
  }

  const json = spec.jsonOnly || rest.includes("--json");
  const argvNoJson = rest.filter((a) => a !== "--json");
  const ctx: RunContext = {
    json,
    cwd: process.cwd(),
    env: process.env,
    stdin: readStdin,
    stderr: (line) => console.error(line),
  };

  try {
    const args = spec.passthrough ? {} : parseArgv(spec, argvNoJson);
    const result = await spec.run(args, ctx, argvNoJson);
    if (spec.passthrough) return Number(process.exitCode ?? 0);
    if (json) {
      console.log(JSON.stringify(result, null, spec.jsonIndent ?? 2));
    } else {
      const text = spec.format ? spec.format(result, args) : JSON.stringify(result, null, 2);
      if (text) console.log(text);
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`usage: ${err.message}\n\n${helpFor(spec)}`);
      return 2;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    return 1;
  }
}

const isDirect = process.argv[1] && (await import("node:url")).fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
