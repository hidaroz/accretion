#!/usr/bin/env node
// Thin stdio MCP adapter: the command specs flagged `mcp: true` become tools,
// with the same zod inputs and the same run() the CLI uses. For clients with no
// shell. Everything else (lifecycle, ops) stays CLI-only.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mcpCommands } from "../cli/commands/index.js";
import type { CommandSpec, RunContext } from "../cli/spec.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export function createServer(): McpServer {
  const server = new McpServer({ name: "accretion", version: pkg.version });
  const ctx: RunContext = {
    json: true,
    cwd: process.cwd(),
    env: process.env,
    stdin: async () => "",
    stderr: (line) => process.stderr.write(line + "\n"),
  };

  for (const spec of mcpCommands() as CommandSpec[]) {
    server.registerTool(
      spec.name,
      {
        description: spec.description ?? spec.summary,
        inputSchema: spec.input.shape,
        annotations: { readOnlyHint: spec.name !== "propose", destructiveHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const parsed = spec.input.parse(args);
          const result = await spec.run(parsed, ctx, []);
          const text =
            spec.mcpOutput === "text" && spec.format
              ? spec.format(result, parsed)
              : JSON.stringify(result, null, spec.jsonIndent ?? 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
        }
      }
    );
  }
  return server;
}

async function main(): Promise<void> {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`accretion-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
