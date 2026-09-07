#!/usr/bin/env node
// Deprecated shim: use `accretion digest-candidates`. Kept for one release so an
// installed weekly loop keeps working while its command file is updated.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "main.js");
console.error("[accretion] scripts/memory-digest-candidates.mjs is deprecated; use `accretion digest-candidates`");
const child = spawn(process.execPath, [cli, "digest-candidates", ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
